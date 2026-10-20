import { GoogleGenAI } from "@google/genai";

/**
 * Retrieval-Augmented Generation helpers for Kada Assist.
 *
 * Industry-standard flow: knowledge-base articles are embedded to vectors on
 * write; at query time we embed the user's question and rank articles by cosine
 * similarity (semantic search), instead of brittle keyword matching. Falls back
 * to keyword matching for articles that don't yet have an embedding.
 *
 * `gemini-embedding-001` → we request 768-dim vectors, stored on each article's
 * `embedding` field. In-memory cosine ranking is plenty for KBs up to a few
 * hundred articles (Firestore has no native vector search on the base API).
 */

export const EMBEDDING_MODEL = "gemini-embedding-001";
export const EMBEDDING_DIMS = 768;
const MAX_EMBED_CHARS = 1800;
const MAX_CHUNKS = 8;

export interface RetrievedArticle {
  id: string;
  title: string;
  content: string;
  score: number;
}

/** Embed a single string → 768-dim vector (empty on failure). */
export async function embedText(
  ai: GoogleGenAI,
  text: string
): Promise<number[]> {
  const clean = (text || "").trim().slice(0, MAX_EMBED_CHARS);
  if (!clean) return [];
  try {
    const res = await ai.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: clean,
      config: { outputDimensionality: EMBEDDING_DIMS },
    });
    return res.embeddings?.[0]?.values ?? [];
  } catch (err) {
    console.error("embedText failed:", err);
    return [];
  }
}

/** The canonical text we embed for an article. */
export function articleEmbedText(title: string, content: string): string {
  return `${title}\n\n${content}`.slice(0, MAX_EMBED_CHARS);
}

export interface ArticleChunk {
  text: string;
  embedding: number[];
}

/**
 * Split a long article so retrieval can hit the paragraph that matches,
 * instead of embedding only the first 1,800 characters.
 */
export function chunkArticle(title: string, content: string): string[] {
  const heading = (title || "").trim();
  const body = (content || "").trim();
  if (!body) return [heading.slice(0, MAX_EMBED_CHARS)];
  const parts: string[] = [];
  let i = 0;
  while (i < body.length && parts.length < MAX_CHUNKS) {
    let end = Math.min(body.length, i + MAX_EMBED_CHARS);
    if (end < body.length) {
      const breakAt = body.lastIndexOf("\n", end);
      if (breakAt > i + 400) end = breakAt;
    }
    const slice = body.slice(i, end).trim();
    if (slice) parts.push(`${heading}\n\n${slice}`.slice(0, MAX_EMBED_CHARS + heading.length + 2));
    if (end <= i) break;
    i = end;
  }
  return parts.length > 0 ? parts : [heading.slice(0, MAX_EMBED_CHARS)];
}

/** Embed every chunk. The first vector is also the article-level embedding. */
export async function embedArticle(
  ai: GoogleGenAI,
  title: string,
  content: string,
): Promise<{ embedding: number[]; chunks: ArticleChunk[] }> {
  const texts = chunkArticle(title, content);
  const chunks: ArticleChunk[] = [];
  for (const text of texts) {
    const embedding = await embedText(ai, text);
    if (embedding.length > 0) chunks.push({ text, embedding });
  }
  return { embedding: chunks[0]?.embedding ?? [], chunks };
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

interface RetrieveOpts {
  query: string;
  role?: string; // 'all' | 'customer' | 'vendor' | 'rider'
  topK?: number;
  minScore?: number;
}

// ── Published-article cache ──────────────────────────────────────────────────
// Cloud Function instances are reused (warm), so without a cache EVERY support
// message re-reads up to 300 KB documents just to rank them — a large, needless
// Firestore cost + latency hit at scale. Cache the published set in-memory with
// a short TTL; freshness within a few minutes is fine for a help KB, and edits
// can clear it immediately via `invalidateKbCache()`.
let _kbCache: { at: number; rows: any[] } | null = null;
const KB_CACHE_TTL_MS = 5 * 60 * 1000;

/** Clear the in-memory published-article cache (call after a KB write). */
export function invalidateKbCache(): void {
  _kbCache = null;
}

async function loadPublishedArticles(
  db: FirebaseFirestore.Firestore
): Promise<any[]> {
  if (_kbCache && Date.now() - _kbCache.at < KB_CACHE_TTL_MS) {
    return _kbCache.rows;
  }
  const snap = await db
    .collection("knowledge_base_articles")
    .where("status", "==", "published")
    .limit(800)
    .get();
  const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
  _kbCache = { at: Date.now(), rows };
  return rows;
}

/**
 * Return the most relevant published KB articles for a query. Uses vector
 * cosine similarity when embeddings are available, else keyword matching.
 */
export async function retrieveRelevantArticles(
  db: FirebaseFirestore.Firestore,
  ai: GoogleGenAI,
  opts: RetrieveOpts
): Promise<RetrievedArticle[]> {
  const query = (opts.query || "").trim();
  const role = (opts.role || "all").toLowerCase();
  const topK = opts.topK ?? 3;
  const minScore = opts.minScore ?? 0.55;
  if (!query) return [];

  let rows: any[];
  try {
    rows = await loadPublishedArticles(db);
  } catch (err) {
    console.error("KB fetch failed:", err);
    return [];
  }

  const candidates = rows
    .filter((a) => {
      const r = (a.role || "all").toLowerCase();
      return r === "all" || r === role;
    });
  if (candidates.length === 0) return [];

  // ── Vector path ────────────────────────────────────────────────────────────
  // Prefer per-chunk embeddings so a match in the middle of a long article
  // is not dropped. Fall back to the single article vector.
  const qVec = await embedText(ai, query);
  if (qVec.length > 0) {
    const scored: { a: any; score: number; content: string }[] = [];
    for (const a of candidates) {
      const chunks = Array.isArray(a.chunks) ? a.chunks : [];
      const usable = chunks.filter(
        (c: any) => c && Array.isArray(c.embedding) && c.embedding.length > 0,
      );
      if (usable.length > 0) {
        let best = usable[0];
        let bestScore = cosineSimilarity(qVec, best.embedding);
        for (const c of usable.slice(1)) {
          const score = cosineSimilarity(qVec, c.embedding);
          if (score > bestScore) {
            best = c;
            bestScore = score;
          }
        }
        scored.push({ a, score: bestScore, content: String(best.text || a.content || "") });
      } else if (Array.isArray(a.embedding) && a.embedding.length > 0) {
        scored.push({
          a,
          score: cosineSimilarity(qVec, a.embedding),
          content: String(a.content || ""),
        });
      }
    }
    scored.sort((x, y) => y.score - x.score);
    const top = scored.filter((s) => s.score >= minScore).slice(0, topK);
    if (top.length > 0) {
      return top.map((s) => ({
        id: s.a.id,
        title: String(s.a.title || ""),
        content: s.content,
        score: s.score,
      }));
    }
  }

  // ── Keyword fallback ────────────────────────────────────────────────────────
  const q = query.toLowerCase();
  const words = q.split(/\s+/).filter((w) => w.length > 3);
  const kw = candidates
    .map((a) => {
      const title = String(a.title || "").toLowerCase();
      const content = String(a.content || "").toLowerCase();
      const tags = Array.isArray(a.tags)
        ? a.tags.map((t: any) => String(t).toLowerCase())
        : [];
      let score = 0;
      if (title.includes(q)) score += 3;
      if (content.includes(q)) score += 1;
      if (tags.some((t: string) => q.includes(t) || t.includes(q))) score += 2;
      score += words.filter((w) => title.includes(w) || content.includes(w)).length;
      return { a, score };
    })
    .filter((s) => s.score > 0)
    .sort((x, y) => y.score - x.score)
    .slice(0, topK);

  return kw.map((s) => ({
    id: s.a.id,
    title: String(s.a.title || ""),
    content: String(s.a.content || ""),
    score: 0,
  }));
}

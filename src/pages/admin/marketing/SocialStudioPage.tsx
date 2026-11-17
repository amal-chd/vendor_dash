import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import {
  collection, deleteDoc, doc, onSnapshot, orderBy, query, serverTimestamp,
  setDoc, Timestamp, writeBatch,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import {
  AlertTriangle, CalendarClock, Check, Copy, ExternalLink, Facebook, ImagePlus, Instagram,
  Download, Linkedin, Loader2, MessageSquareText, Plus, RefreshCw, Send, Trash2,
  Upload, WandSparkles,
} from "lucide-react";
import { toast } from "sonner";
import { auth, db, functions, storage } from "@/lib/firebase";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SOCIAL_PROMPT_BOOK } from "./socialStudioPlan";
import { BRAND_DOC } from "./marketingData";
import { BRAND_PROFILES_COLLECTION, BRAND_PROFILE_OPTIONS, buildBrandProfileMap, DEFAULT_BRAND_PROFILES_BY_ID, inferBrandProfileId, type BrandProfile } from "./brandProfiles";
import { getPromptBookImportPlan, parsePromptBookJson, toSocialDraft, type PromptBook } from "./socialStudioImport";
import { createPosterPrompt } from "./socialStudioPrompt";

const POSTS = "marketing_social_posts";
const CONNECTIONS = "marketing_social_connections";
const MAX_POSTER_BYTES = 8 * 1024 * 1024;
const PLATFORM_KEYS = ["instagram", "facebook", "linkedin"] as const;
type Platform = (typeof PLATFORM_KEYS)[number];
type PostStatus = "draft" | "scheduled" | "publishing" | "published" | "partial" | "failed";
type SocialTarget = { id: string; label: string };
type PlatformResult = { status: string; message?: string; postId?: string; publishedAt?: unknown };
type SocialPost = {
  id: string; title: string; category: string; audience: string; goal: string;
  headline: string; support: string; cta: string; caption: string;
  captions: Partial<Record<Platform, string>>; imagePrompt: string; visualDirection: string;
  assetPath?: string; assetUrl?: string; assetName?: string;
  referenceAssets?: { path: string; name: string; url: string }[];
  destinations?: Partial<Record<Platform, string>>;
  platformResults?: Partial<Record<Platform, PlatformResult>>;
  status: PostStatus; scheduledAt?: Timestamp | null; planId?: string; planDay?: number; brandProfileId?: string; dailyPrompt?: string;
  createdAt?: Timestamp; updatedAt?: Timestamp; publishStartedAt?: Timestamp; error?: string;
};
type MetaConnection = {
  connected?: boolean; connectedAt?: Timestamp; tokenExpiresAt?: Timestamp | null;
  facebook?: SocialTarget[]; instagram?: SocialTarget[];
};
type LinkedInConnection = {
  connected?: boolean; memberName?: string; connectedAt?: Timestamp;
  organizationUrn?: string; organizationName?: string;
};

const platformNames: Record<Platform, string> = {
  instagram: "Instagram", facebook: "Facebook Page", linkedin: "LinkedIn Page",
};
const statusStyles: Record<PostStatus, string> = {
  draft: "bg-slate-100 text-slate-700", scheduled: "bg-blue-100 text-blue-800",
  publishing: "bg-amber-100 text-amber-900", published: "bg-emerald-100 text-emerald-800",
  partial: "bg-orange-100 text-orange-900", failed: "bg-rose-100 text-rose-800",
};

const blankForm = () => ({
  id: "" as string,
  title: "", category: "Brand", audience: "", goal: "", headline: "", support: "", cta: "",
  caption: "", captions: { instagram: "", facebook: "", linkedin: "" } as Record<Platform, string>,
  imagePrompt: "", visualDirection: "", assetPath: "", assetUrl: "", assetName: "",
  referenceAssets: [] as { path: string; name: string; url: string }[],
  destinations: {} as Partial<Record<Platform, string>>,
  planId: "" as string,
  planDay: undefined as number | undefined,
  brandProfileId: "kadaverse",
  dailyPrompt: "",
  scheduleLocal: "",
});
type EditorForm = ReturnType<typeof blankForm>;

const STARTER_BOOK = parsePromptBookJson(JSON.stringify(SOCIAL_PROMPT_BOOK));
const MAX_PROMPT_BOOK_BYTES = 1024 * 1024;

function humanError(error: unknown) {
  const value = error as { message?: string; code?: string };
  return value?.message?.replace(/^Firebase: /, "") || "Something went wrong. Please try again.";
}

function toLocalDate(value?: Timestamp | null) {
  const date = value?.toDate();
  if (!date) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export default function SocialStudioPage() {
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [meta, setMeta] = useState<MetaConnection>({});
  const [linkedin, setLinkedin] = useState<LinkedInConnection>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState<Platform | "meta" | null>(null);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [editing, setEditing] = useState<EditorForm | null>(null);
  const [linkedinUrn, setLinkedinUrn] = useState("");
  const [filter, setFilter] = useState<"all" | PostStatus>("all");
  const [savedBrandProfiles, setSavedBrandProfiles] = useState<Record<string, Partial<BrandProfile>>>({});
  const [legacyKadaBrand, setLegacyKadaBrand] = useState<Partial<BrandProfile>>();
  const promptBookInput = useRef<HTMLInputElement>(null);
  const importingBook = useRef(false);
  const brandProfiles = useMemo(() => buildBrandProfileMap(savedBrandProfiles, legacyKadaBrand), [savedBrandProfiles, legacyKadaBrand]);

  useEffect(() => {
    const unsubPosts = onSnapshot(query(collection(db, POSTS), orderBy("updatedAt", "desc")), (snapshot) => {
      void Promise.all(snapshot.docs.map(async (item) => {
        const post = { id: item.id, ...(item.data() as Omit<SocialPost, "id">) };
        if (post.assetPath) post.assetUrl = await getDownloadURL(storageRef(storage, post.assetPath)).catch(() => "");
        if (post.referenceAssets?.length) {
          post.referenceAssets = await Promise.all(post.referenceAssets.map(async (asset) => ({
            ...asset, url: asset.url || await getDownloadURL(storageRef(storage, asset.path)).catch(() => ""),
          })));
        }
        return post;
      })).then((values) => { setPosts(values); setLoading(false); });
    }, (error) => { toast.error(humanError(error)); setLoading(false); });
    const unsubMeta = onSnapshot(doc(db, CONNECTIONS, "meta"), (snapshot) => setMeta((snapshot.data() as MetaConnection) ?? {}));
    const unsubLinkedIn = onSnapshot(doc(db, CONNECTIONS, "linkedin"), (snapshot) => {
      const value = (snapshot.data() as LinkedInConnection) ?? {};
      setLinkedin(value);
      setLinkedinUrn(value.organizationUrn ?? "");
    });
    const unsubProfiles = onSnapshot(collection(db, BRAND_PROFILES_COLLECTION), (snapshot) => {
      const rows: Record<string, Partial<BrandProfile>> = {};
      snapshot.docs.forEach((item) => { rows[item.id] = item.data() as Partial<BrandProfile>; });
      setSavedBrandProfiles(rows);
    }, (error) => toast.error(`Couldn't load brand profiles: ${humanError(error)}`));
    const unsubLegacyBrand = onSnapshot(doc(db, ...BRAND_DOC), (snapshot) => {
      if (snapshot.exists()) setLegacyKadaBrand(snapshot.data() as Partial<BrandProfile>);
    });
    return () => { unsubPosts(); unsubMeta(); unsubLinkedIn(); unsubProfiles(); unsubLegacyBrand(); };
  }, []);

  const templatesImported = useMemo(() => new Set(posts
    .filter((post) => (post.planId || "kadaverse-30-day-social-v1") === STARTER_BOOK.id)
    .map((post) => post.planDay).filter((day): day is number => typeof day === "number")), [posts]);
  const filteredPosts = useMemo(() => filter === "all" ? posts : posts.filter((post) => post.status === filter), [filter, posts]);
  const destinations: Record<Platform, SocialTarget[]> = {
    instagram: meta.instagram ?? [], facebook: meta.facebook ?? [],
    linkedin: linkedin.connected && linkedin.organizationUrn ? [{ id: linkedin.organizationUrn, label: linkedin.organizationName || linkedin.organizationUrn }] : [],
  };

  const beginNew = useCallback((day?: number) => {
    const next = blankForm();
    if (day) {
      const brief = STARTER_BOOK.posts.find((item) => item.day === day);
      if (brief) {
        next.planId = STARTER_BOOK.id;
        next.planDay = brief.day;
        next.brandProfileId = brief.brandProfileId || "kadaverse";
        next.title = `Day ${String(brief.day).padStart(2, "0")} · ${brief.title}`;
        next.category = brief.category;
        next.audience = brief.audience;
        next.goal = brief.goal;
        next.headline = brief.headline;
        next.support = brief.support;
        next.cta = brief.cta;
        next.caption = brief.caption + (brief.ctaNote ? `\n\n${brief.ctaNote}` : "");
        next.captions = {
          instagram: next.caption,
          facebook: next.caption,
          linkedin: next.caption,
        };
        next.visualDirection = brief.visualDirection;
        next.dailyPrompt = brief.dailyPrompt;
        next.destinations = {
          ...(destinations.instagram[0] ? { instagram: destinations.instagram[0].id } : {}),
          ...(destinations.facebook[0] ? { facebook: destinations.facebook[0].id } : {}),
          ...(destinations.linkedin[0] ? { linkedin: destinations.linkedin[0].id } : {}),
        };
      }
    }
    setEditing(next);
  }, [destinations.facebook, destinations.instagram, destinations.linkedin]);

  const importBook = async (book: PromptBook) => {
    if (loading) {
      toast.error("Wait for the social calendar to finish loading before importing.");
      return;
    }
    if (importingBook.current) return;
    importingBook.current = true;
    setLoadingPlan(true);
    try {
      const { pending, skipped } = getPromptBookImportPlan(book, posts);
      for (let i = 0; i < pending.length; i += 400) {
        const batch = writeBatch(db);
        pending.slice(i, i + 400).forEach((brief) => {
          const ref = doc(collection(db, POSTS));
          batch.set(ref, {
            ...toSocialDraft(brief, book.id),
            createdBy: auth.currentUser?.uid ?? "",
            createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
          });
        });
        await batch.commit();
      }
      if (pending.length) toast.success(`${pending.length} brief${pending.length === 1 ? "" : "s"} imported as drafts${skipped.length ? ` · ${skipped.length} duplicate${skipped.length === 1 ? "" : "s"} skipped` : ""}.`);
      else toast.message(`This prompt book is already in the studio (${skipped.length} duplicate${skipped.length === 1 ? "" : "s"} skipped).`);
    } catch (error) { toast.error(humanError(error)); }
    finally { importingBook.current = false; setLoadingPlan(false); }
  };

  const importPromptBookFile = async (file: File) => {
    if (file.size > MAX_PROMPT_BOOK_BYTES) {
      toast.error("Prompt books must be smaller than 1 MB.");
      return;
    }
    try {
      const book = parsePromptBookJson(await file.text());
      await importBook(book);
    } catch (error) { toast.error(humanError(error)); }
  };

  const downloadPromptBook = () => {
    const file = new Blob([JSON.stringify(SOCIAL_PROMPT_BOOK, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(file);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "KadaVerse_30_Day_Social_Prompt_Book.json";
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const connect = async (provider: "meta" | "linkedin") => {
    setConnecting(provider);
    const popup = window.open("about:blank", "_blank");
    if (popup) popup.opener = null;
    try {
      const result = await httpsCallable<{ provider: string }, { authorizationUrl: string }>(functions, "socialStartOAuth")({ provider });
      if (popup) popup.location.assign(result.data.authorizationUrl);
      else window.location.assign(result.data.authorizationUrl);
      toast.success(`Finish the ${provider === "meta" ? "Meta" : "LinkedIn"} authorization in the new tab, then refresh account status.`);
    } catch (error) { popup?.close(); toast.error(humanError(error)); }
    finally { setConnecting(null); }
  };

  const disconnect = async (provider: "meta" | "linkedin") => {
    const name = provider === "meta" ? "Meta (Facebook and Instagram)" : "LinkedIn";
    if (!window.confirm(`Disconnect ${name}? Scheduled posts for this account will fail until it is reconnected.`)) return;
    try {
      await httpsCallable<{ provider: string }, { ok: boolean }>(functions, "socialDisconnect")({ provider });
      toast.success(`${name} disconnected.`);
    } catch (error) { toast.error(humanError(error)); }
  };

  const saveLinkedInOrganization = async () => {
    try {
      await httpsCallable<{ organizationUrn: string }, { ok: boolean }>(functions, "socialSetLinkedInOrganization")({ organizationUrn: linkedinUrn.trim() });
      toast.success("LinkedIn company page saved.");
    } catch (error) { toast.error(humanError(error)); }
  };

  const createPrompt = async () => {
    if (!editing) return;
    const prompt = createPosterPrompt({ ...editing, referenceAssetNames: editing.referenceAssets.map((asset) => asset.name) }, brandProfiles[editing.brandProfileId] ?? DEFAULT_BRAND_PROFILES_BY_ID.kadaverse);
    setEditing({ ...editing, imagePrompt: prompt });
  };

  const uploadAsset = async (file: File, kind: "poster" | "reference") => {
    if (!editing || !auth.currentUser) return;
    if (!/^image\/(jpeg|png)$/.test(file.type)) {
      toast.error("Choose a JPG or PNG image so every network can publish it."); return;
    }
    if (file.size > MAX_POSTER_BYTES) { toast.error("Keep each image under 8 MB."); return; }
    setSaving(true);
    try {
      const postId = editing.id || doc(collection(db, POSTS)).id;
      const ext = file.type === "image/png" ? "png" : "jpg";
      const path = `social_assets/${auth.currentUser.uid}/${postId}/${kind}_${Date.now()}.${ext}`;
      const assetRef = storageRef(storage, path);
      await uploadBytes(assetRef, file, { contentType: file.type, customMetadata: { postId, kind } });
      const url = await getDownloadURL(assetRef);
      if (kind === "poster") {
        setEditing({ ...editing, id: postId, assetPath: path, assetUrl: url, assetName: file.name });
      } else {
        setEditing({ ...editing, id: postId, referenceAssets: [...editing.referenceAssets, { path, url, name: file.name }] });
      }
      toast.success(kind === "poster" ? "Poster artwork uploaded." : "Reference image added.");
    } catch (error) { toast.error(humanError(error)); }
    finally { setSaving(false); }
  };

  const savePost = async (mode: "draft" | "scheduled" | "publish") => {
    if (!editing) return;
    if (!editing.title.trim()) { toast.error("Give this post a title first."); return; }
    if (mode !== "draft") {
      if (!editing.assetPath) { toast.error("Upload the finished JPG or PNG poster before scheduling or publishing."); return; }
      const chosen = PLATFORM_KEYS.filter((platform) => editing.destinations[platform]);
      if (!chosen.length) { toast.error("Choose at least one connected social account."); return; }
      for (const platform of chosen) {
        if (!destinations[platform].some((target) => target.id === editing.destinations[platform])) {
          toast.error(`Choose an available ${platformNames[platform]} account.`); return;
        }
        if (!(editing.captions[platform] || editing.caption).trim()) { toast.error(`Add caption copy for ${platformNames[platform]}.`); return; }
      }
    }
    let scheduledAt: Timestamp | null = null;
    if (mode === "scheduled") {
      const parsed = new Date(editing.scheduleLocal);
      if (!editing.scheduleLocal || Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
        toast.error("Choose a future date and time."); return;
      }
      scheduledAt = Timestamp.fromDate(parsed);
    }
    setSaving(true);
    try {
      const currentId = editing.id || doc(collection(db, POSTS)).id;
      const postRef = doc(db, POSTS, currentId);
      const persistedPost = posts.some((post) => post.id === currentId);
      const payload = {
        title: editing.title.trim(), category: editing.category, audience: editing.audience.trim(), goal: editing.goal.trim(),
        headline: editing.headline.trim(), support: editing.support.trim(), cta: editing.cta.trim(), caption: editing.caption.trim(),
        captions: Object.fromEntries(PLATFORM_KEYS.map((platform) => [platform, (editing.captions[platform] || editing.caption).trim()])),
        imagePrompt: editing.imagePrompt, dailyPrompt: editing.dailyPrompt, visualDirection: editing.visualDirection,
        brandProfileId: editing.brandProfileId || "kadaverse",
        assetPath: editing.assetPath || "", assetName: editing.assetName || "",
        referenceAssets: editing.referenceAssets.map(({ path, name }) => ({ path, name })), destinations: editing.destinations,
        ...(editing.planId ? { planId: editing.planId } : {}),
        ...(editing.planDay ? { planDay: editing.planDay } : {}),
        status: mode === "scheduled" ? "scheduled" : mode === "publish" ? "draft" : "draft",
        scheduledAt: mode === "scheduled" ? scheduledAt : null,
        ...(persistedPost ? { updatedAt: serverTimestamp() } : { createdAt: serverTimestamp(), createdBy: auth.currentUser?.uid ?? "", updatedAt: serverTimestamp() }),
      };
      await setDoc(postRef, payload, { merge: true });
      if (mode === "publish") {
        await httpsCallable<{ postId: string }, { ok: boolean; status: string }>(functions, "socialPublishNow")({ postId: currentId });
        toast.success("Publish request sent. Results will appear beside each network.");
      } else {
        toast.success(mode === "scheduled" ? "Post scheduled." : "Draft saved.");
      }
      setEditing(null);
    } catch (error) { toast.error(humanError(error)); }
    finally { setSaving(false); }
  };

  const editPost = (post: SocialPost) => {
    const form = blankForm();
    Object.assign(form, post);
    form.id = post.id;
    form.planId = post.planId ?? "";
    form.brandProfileId = inferBrandProfileId(post.title, post.brandProfileId);
    form.dailyPrompt = post.dailyPrompt ?? (post.imagePrompt?.startsWith("Create one polished") ? "" : post.imagePrompt ?? "");
    form.imagePrompt = post.dailyPrompt ? post.imagePrompt ?? "" : (post.imagePrompt?.startsWith("Create one polished") ? post.imagePrompt : "");
    form.captions = {
      instagram: post.captions?.instagram ?? post.caption ?? "",
      facebook: post.captions?.facebook ?? post.caption ?? "",
      linkedin: post.captions?.linkedin ?? post.caption ?? "",
    };
    form.destinations = post.destinations ?? {};
    form.referenceAssets = post.referenceAssets ?? [];
    form.scheduleLocal = toLocalDate(post.scheduledAt);
    setEditing(form);
  };

  const deletePost = async (post: SocialPost) => {
    if (!window.confirm(`Delete “${post.title}”? This removes the post draft and uploaded creative from the studio.`)) return;
    try {
      const paths = [post.assetPath, ...(post.referenceAssets ?? []).map((item) => item.path)].filter(Boolean) as string[];
      await Promise.all(paths.map((path) => deleteObject(storageRef(storage, path)).catch(() => undefined)));
      await deleteDoc(doc(db, POSTS, post.id));
      toast.success("Post removed.");
    } catch (error) { toast.error(humanError(error)); }
  };

  const publishAgain = async (post: SocialPost) => {
    const result = post.platformResults ?? {};
    const ambiguous = PLATFORM_KEYS.some((platform) => result[platform]?.status === "publishing" || result[platform]?.status === "unknown");
    const message = ambiguous
      ? "A previous attempt may have reached a social network. Check the selected account first; retrying could create a duplicate. Continue only if you verified the post is not live."
      : "Retry the failed network deliveries now? Successful networks will be skipped.";
    if (!window.confirm(message)) return;
    try {
      await httpsCallable<{ postId: string; confirmAmbiguousRetry: boolean }, { ok: boolean; status: string }>(functions, "socialPublishNow")({ postId: post.id, confirmAmbiguousRetry: ambiguous });
      toast.success("Retry request sent.");
    } catch (error) { toast.error(humanError(error)); }
  };

  const statusCounts = useMemo(() => posts.reduce<Record<string, number>>((acc, post) => {
    acc[post.status] = (acc[post.status] ?? 0) + 1; return acc;
  }, {}), [posts]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Social Studio</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Turn the KadaVerse 30-day plan into approved creative, platform-ready captions, and scheduled posts for Instagram, Facebook and LinkedIn.</p>
        </div>
        <Button onClick={() => beginNew()}><Plus className="mr-2 h-4 w-4" /> New post</Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3"><CardTitle className="text-base">Connect publishing accounts</CardTitle><CardDescription>Meta connects Facebook Pages and their linked Instagram professional accounts. LinkedIn connects a company page through an authorized member.</CardDescription></CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border p-4">
              <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2 font-medium"><span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-pink-500 via-orange-400 to-purple-600 text-white"><Instagram className="h-4 w-4" /></span>Meta · Instagram + Facebook</div><Badge variant="outline">{meta.connected ? "Connected" : "Not connected"}</Badge></div>
              {meta.connected && <div className="mt-3 space-y-1 text-xs text-muted-foreground"><p>{meta.facebook?.length ?? 0} Facebook Page(s) · {meta.instagram?.length ?? 0} Instagram professional account(s)</p><p>Select targets in each post. Reconnect if Meta access expires.</p></div>}
              <div className="mt-3 flex gap-2"><Button className="flex-1" variant="outline" onClick={() => connect("meta")} disabled={connecting === "meta"}>{connecting === "meta" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ExternalLink className="mr-2 h-4 w-4" />}{meta.connected ? "Reconnect Meta" : "Connect Meta account"}</Button>{meta.connected && <Button variant="ghost" onClick={() => disconnect("meta")}>Disconnect</Button>}</div>
            </div>
            <div className="rounded-xl border p-4">
              <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2 font-medium"><span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-sky-700 text-white"><Linkedin className="h-4 w-4" /></span>LinkedIn Company Page</div><Badge variant="outline">{linkedin.connected ? "Connected" : "Not connected"}</Badge></div>
              {linkedin.connected && <p className="mt-3 text-xs text-muted-foreground">Authorized as {linkedin.memberName || "LinkedIn member"}. Add the company Page organization URN below.</p>}
              <div className="mt-3 flex gap-2"><Button className="flex-1" variant="outline" onClick={() => connect("linkedin")} disabled={connecting === "linkedin"}>{connecting === "linkedin" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ExternalLink className="mr-2 h-4 w-4" />}{linkedin.connected ? "Reconnect LinkedIn" : "Connect LinkedIn"}</Button>{linkedin.connected && <Button variant="ghost" onClick={() => disconnect("linkedin")}>Disconnect</Button>}</div>
              {linkedin.connected && <div className="mt-3 flex gap-2"><Input placeholder="urn:li:organization:123456" value={linkedinUrn} onChange={(e) => setLinkedinUrn(e.target.value)} /><Button variant="secondary" onClick={saveLinkedInOrganization} disabled={!linkedinUrn.trim()}>Save Page</Button></div>}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Prompt book</CardTitle><CardDescription>Download the 30-day KadaVerse book or import your own compatible prompt book. Each entry becomes a draft.</CardDescription></CardHeader>
          <CardContent className="space-y-2">
            <div className="mb-3 flex items-center gap-2 text-sm"><Check className="h-4 w-4 text-emerald-600" />{templatesImported.size}/{STARTER_BOOK.posts.length} starter briefs already in this studio</div>
            <Button variant="secondary" className="w-full" onClick={() => void importBook(STARTER_BOOK)} disabled={loading || loadingPlan || templatesImported.size === STARTER_BOOK.posts.length}>{loadingPlan ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CalendarClock className="mr-2 h-4 w-4" />}{templatesImported.size ? "Import remaining starter briefs" : "Import 30-day plan"}</Button>
            <Button variant="outline" className="w-full" onClick={downloadPromptBook}><Download className="mr-2 h-4 w-4" />Download prompt book JSON</Button>
            <input ref={promptBookInput} className="sr-only" type="file" accept=".json,application/json" aria-label="Choose prompt book JSON" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importPromptBookFile(file); event.currentTarget.value = ""; }} />
            <Button variant="outline" className="w-full" onClick={() => promptBookInput.current?.click()} disabled={loading || loadingPlan}><Upload className="mr-2 h-4 w-4" />{loadingPlan ? "Importing prompts…" : "Import prompt book JSON"}</Button>
            <p className="mt-2 text-xs text-muted-foreground">The importer checks the schema, required copy, unique IDs and days before writing anything. Re-importing a book skips entries already in the calendar. Upload artwork and review drafts before scheduling or publishing.</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Publishing readiness</CardTitle><CardDescription>API access is controlled by each social network. The studio shows a connection only after the account authorization succeeds.</CardDescription></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <Readiness name="Instagram" connected={Boolean(meta.connected && meta.instagram?.length)} detail={meta.instagram?.length ? `${meta.instagram.length} professional account(s) found` : "Requires Business or Creator profile and Meta publishing permissions"} />
          <Readiness name="Facebook" connected={Boolean(meta.connected && meta.facebook?.length)} detail={meta.facebook?.length ? `${meta.facebook.length} Page(s) found` : "Requires a Facebook Page and Meta Page publishing permissions"} />
          <Readiness name="LinkedIn" connected={Boolean(linkedin.connected && linkedin.organizationUrn)} detail={linkedin.organizationUrn ? linkedin.organizationName || linkedin.organizationUrn : "Requires approved Community Management API access and a company Page URN"} />
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h2 className="text-lg font-semibold">Content calendar</h2><p className="text-sm text-muted-foreground">Draft, schedule, publish, and see delivery status for each network.</p></div>
        <div className="flex flex-wrap gap-2">{(["all", "draft", "scheduled", "published", "partial", "failed"] as const).map((item) => <Button key={item} size="sm" variant={filter === item ? "default" : "outline"} onClick={() => setFilter(item)}>{item === "all" ? `All (${posts.length})` : `${item[0].toUpperCase()}${item.slice(1)} (${statusCounts[item] ?? 0})`}</Button>)}</div>
      </div>

      {loading ? <div className="py-12 text-center text-sm text-muted-foreground"><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />Loading social posts…</div>
        : filteredPosts.length === 0 ? <Card><CardContent className="py-12 text-center"><MessageSquareText className="mx-auto mb-3 h-8 w-8 text-muted-foreground" /><p className="font-medium">No posts in this view yet</p><p className="mt-1 text-sm text-muted-foreground">Import the 30-day plan or start a new post.</p><Button className="mt-4" variant="outline" onClick={() => beginNew()}>Create a post</Button></CardContent></Card>
          : <div className="grid gap-3">{filteredPosts.map((post) => <PostCard key={post.id} post={post} onEdit={() => editPost(post)} onDelete={() => deletePost(post)} onPublish={() => publishAgain(post)} />)}</div>}

      {editing && <EditorDialog
        form={editing}
        setForm={setEditing}
        saving={saving}
        destinations={destinations}
        brandProfiles={brandProfiles}
        onClose={() => setEditing(null)}
        onSave={savePost}
        onUpload={uploadAsset}
        onCreatePrompt={createPrompt}
      />}

      <p className="flex gap-2 text-xs text-muted-foreground"><AlertTriangle className="h-4 w-4 shrink-0" />Posts publish as single static images with captions. Reels, Stories, carousels and video are outside this first integrated publishing flow.</p>
    </div>
  );
}

function Readiness({ name, connected, detail }: { name: string; connected: boolean; detail: string }) {
  return <div className="flex gap-3 rounded-lg border p-3"><span className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${connected ? "bg-emerald-500" : "bg-amber-400"}`} /><div><p className="text-sm font-medium">{name}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div></div>;
}

function PostCard({ post, onEdit, onDelete, onPublish }: { post: SocialPost; onEdit: () => void; onDelete: () => void; onPublish: () => void }) {
  const results = post.platformResults ?? {};
  const stalePublishing = post.status === "publishing" && Boolean(post.publishStartedAt && post.publishStartedAt.toMillis() < Date.now() - 10 * 60_000);
  const networkIcons: Record<Platform, ComponentType<{ className?: string }>> = { instagram: Instagram, facebook: Facebook, linkedin: Linkedin };
  return <Card>
    <CardContent className="flex flex-col gap-4 p-4 md:flex-row md:items-center">
      {post.assetUrl ? <img src={post.assetUrl} alt="Poster preview" className="h-24 w-20 rounded-md border object-cover" /> : <div className="flex h-24 w-20 items-center justify-center rounded-md border bg-muted text-muted-foreground"><ImagePlus className="h-6 w-6" /></div>}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{post.title}</h3><Badge className={statusStyles[post.status]} variant="secondary">{post.status}</Badge><Badge variant="outline">{post.category}</Badge><Badge variant="outline">{DEFAULT_BRAND_PROFILES_BY_ID[post.brandProfileId ?? inferBrandProfileId(post.title)]?.name ?? "KadaVerse"}</Badge>{post.planDay && <Badge variant="outline">Day {post.planDay}</Badge>}</div>
        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{post.headline || post.caption || "No copy added yet."}</p>
        {post.scheduledAt && <p className="mt-1 text-xs text-muted-foreground">Scheduled {post.scheduledAt.toDate().toLocaleString()}</p>}
        <div className="mt-2 flex flex-wrap gap-2">{PLATFORM_KEYS.filter((platform) => post.destinations?.[platform]).map((platform) => { const Icon = networkIcons[platform]; const result = results[platform]; return <span key={platform} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"><Icon className="h-3 w-3" />{platformNames[platform]}: {result?.status ?? post.status}{result?.message ? ` · ${result.message}` : ""}</span>; })}</div>
        {post.error && <p className="mt-2 text-xs text-rose-700">{post.error}</p>}
      </div>
      <div className="flex shrink-0 gap-2">
        {(post.status === "draft" || post.status === "failed" || post.status === "partial" || stalePublishing) && <Button size="sm" variant="outline" onClick={onPublish}>{post.status === "draft" ? <Send className="mr-1.5 h-3.5 w-3.5" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}{stalePublishing ? "Check & retry" : post.status === "draft" ? "Publish now" : "Retry"}</Button>}
        {post.status !== "publishing" && post.status !== "published" && <Button size="sm" variant="outline" onClick={onEdit}>Edit</Button>}
        {post.status !== "publishing" && post.status !== "published" && <Button size="icon" variant="ghost" aria-label="Delete post" onClick={onDelete}><Trash2 className="h-4 w-4" /></Button>}
      </div>
    </CardContent>
  </Card>;
}

function EditorDialog({
  form, setForm, saving, destinations, brandProfiles, onClose, onSave, onUpload, onCreatePrompt,
}: {
  form: EditorForm; setForm: (form: EditorForm) => void; saving: boolean;
  brandProfiles: Record<string, BrandProfile>;
  destinations: Record<Platform, SocialTarget[]>; onClose: () => void;
  onSave: (mode: "draft" | "scheduled" | "publish") => void;
  onUpload: (file: File, kind: "poster" | "reference") => void; onCreatePrompt: () => void;
}) {
  const [captionPlatform, setCaptionPlatform] = useState<Platform>("instagram");
  const brand = brandProfiles[form.brandProfileId] ?? DEFAULT_BRAND_PROFILES_BY_ID.kadaverse;
  const setField = <K extends keyof EditorForm>(key: K, value: EditorForm[K]) => setForm({ ...form, [key]: value });
  const setDestination = (platform: Platform, value: string) => setForm({ ...form, destinations: { ...form.destinations, [platform]: value || undefined } });
  const setCaption = (platform: Platform, value: string) => setForm({ ...form, captions: { ...form.captions, [platform]: value } });
  const copyPrompt = async () => {
    const value = form.imagePrompt || createPosterPrompt({ ...form, referenceAssetNames: form.referenceAssets.map((asset) => asset.name) }, brand);
    try { await navigator.clipboard.writeText(value); toast.success("Poster prompt copied."); }
    catch { setForm({ ...form, imagePrompt: value }); toast.message("Prompt placed in the image prompt field."); }
  };
  const activeCaption = form.captions[captionPlatform] || form.caption;
  return <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 p-3 md:p-8" role="dialog" aria-modal="true" aria-label="Social post editor">
    <div className="mx-auto my-4 max-w-5xl rounded-xl bg-background shadow-xl">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-background px-5 py-4"><div><h2 className="text-lg font-semibold">{form.id ? "Edit social post" : "Create social post"}</h2><p className="text-xs text-muted-foreground">Prepare copy and creative, then save, schedule, or publish.</p></div><Button variant="ghost" onClick={onClose}>Close</Button></div>
      <div className="grid gap-5 p-5 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Post title"><Input value={form.title} onChange={(e) => setField("title", e.target.value)} placeholder="Campaign or creative name" /></Field>
            <Field label="Category"><Input value={form.category} onChange={(e) => setField("category", e.target.value)} placeholder="Product, service, trust, brand…" /></Field>
            <Field label="Brand profile"><select className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={form.brandProfileId} onChange={(e) => setForm({ ...form, brandProfileId: e.target.value, imagePrompt: "" })}>{BRAND_PROFILE_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.name} · {option.section}</option>)}</select><span className="block text-xs text-muted-foreground">Using {brand.palette.primary}, {brand.palette.accent} and {brand.font}.</span></Field>
            <Field label="Audience"><Input value={form.audience} onChange={(e) => setField("audience", e.target.value)} placeholder="Who should this reach?" /></Field>
            <Field label="Campaign goal"><Input value={form.goal} onChange={(e) => setField("goal", e.target.value)} placeholder="Awareness, enquiry, app installs…" /></Field>
          </div>
          <Field label="Poster headline"><Input value={form.headline} onChange={(e) => setField("headline", e.target.value)} placeholder="Short, phone-readable line" /></Field>
          <Field label="Poster support copy"><Input value={form.support} onChange={(e) => setField("support", e.target.value)} placeholder="One clear benefit or proof point" /></Field>
          <Field label="Poster call to action"><Input value={form.cta} onChange={(e) => setField("cta", e.target.value)} placeholder="What should the viewer do next?" /></Field>
          <Field label="Visual direction"><Textarea value={form.visualDirection} onChange={(e) => setField("visualDirection", e.target.value)} rows={3} placeholder="Composition, product screen, mood, props and reference cue" /></Field>
          <Field label="Campaign visual prompt"><Textarea value={form.dailyPrompt} onChange={(e) => setField("dailyPrompt", e.target.value)} rows={3} placeholder="Specific scene, prop, composition or screenshot direction for this campaign" /></Field>
          <Field label="Full image-generation prompt"><Textarea value={form.imagePrompt} onChange={(e) => setField("imagePrompt", e.target.value)} rows={8} placeholder="Build a complete poster prompt from this brand profile and campaign brief" /><div className="mt-2 flex flex-wrap gap-2"><Button size="sm" variant="secondary" onClick={onCreatePrompt}><WandSparkles className="mr-2 h-4 w-4" />Build full brand prompt</Button><Button size="sm" variant="outline" onClick={copyPrompt}><Copy className="mr-2 h-4 w-4" />Copy prompt</Button></div></Field>
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><Label>Social caption</Label><div className="flex gap-1">{PLATFORM_KEYS.map((platform) => <Button key={platform} size="sm" variant={captionPlatform === platform ? "default" : "outline"} onClick={() => setCaptionPlatform(platform)}>{platformNames[platform].replace(" Page", "")}</Button>)}</div></div>
            <Textarea value={activeCaption} onChange={(e) => setCaption(captionPlatform, e.target.value)} rows={5} placeholder={`Write a caption for ${platformNames[captionPlatform]}`} />
            <p className="mt-1 text-xs text-muted-foreground">Captions are saved separately per platform. Blank platform captions inherit the base campaign caption when saving.</p>
          </div>
        </div>

        <div className="space-y-4">
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Poster artwork</CardTitle><CardDescription>Upload final JPG or PNG artwork; maximum 8 MB. The same asset is posted to selected networks.</CardDescription></CardHeader><CardContent>
            {form.assetUrl ? <div className="mb-3 overflow-hidden rounded-lg border"><img src={form.assetUrl} alt="Uploaded social poster preview" className="max-h-80 w-full object-contain bg-muted" /><p className="border-t px-3 py-2 text-xs text-muted-foreground">{form.assetName || "Uploaded poster"}</p></div> : <div className="mb-3 flex h-48 flex-col items-center justify-center rounded-lg border border-dashed bg-muted/30 text-center text-sm text-muted-foreground"><ImagePlus className="mb-2 h-6 w-6" />No artwork uploaded</div>}
            <label className="flex cursor-pointer items-center justify-center rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent"><Upload className="mr-2 h-4 w-4" />Upload finished artwork<input className="sr-only" type="file" accept="image/jpeg,image/png" onChange={(e) => { const file = e.target.files?.[0]; if (file) onUpload(file, "poster"); e.currentTarget.value = ""; }} /></label>
          </CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Reference images</CardTitle><CardDescription>Add brand assets or visual references to keep with the brief.</CardDescription></CardHeader><CardContent>
            <label className="flex cursor-pointer items-center justify-center rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent"><ImagePlus className="mr-2 h-4 w-4" />Add reference image<input className="sr-only" type="file" accept="image/jpeg,image/png" onChange={(e) => { const file = e.target.files?.[0]; if (file) onUpload(file, "reference"); e.currentTarget.value = ""; }} /></label>
            {form.referenceAssets.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{form.referenceAssets.map((image) => <img key={image.path} src={image.url} alt={image.name} title={image.name} className="h-14 w-14 rounded border object-cover" />)}</div>}
          </CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Publish targets</CardTitle><CardDescription>Choose the authorized account for each network.</CardDescription></CardHeader><CardContent className="space-y-3">
            {PLATFORM_KEYS.map((platform) => <Field key={platform} label={platformNames[platform]}><select className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={form.destinations[platform] ?? ""} onChange={(e) => setDestination(platform, e.target.value)}><option value="">Do not publish to {platformNames[platform]}</option>{destinations[platform].map((target) => <option key={target.id} value={target.id}>{target.label}</option>)}</select>{!destinations[platform].length && <p className="text-xs text-amber-700">Connect an account to publish here.</p>}</Field>)}
          </CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Schedule</CardTitle><CardDescription>Times follow your browser’s local time zone.</CardDescription></CardHeader><CardContent className="space-y-2">
            <Input type="datetime-local" value={form.scheduleLocal} onChange={(e) => setField("scheduleLocal", e.target.value)} />
            <p className="text-xs text-muted-foreground">The server checks for due posts every minute and records a separate result for each network.</p>
          </CardContent></Card>
        </div>
      </div>
      <div className="sticky bottom-0 flex flex-wrap justify-end gap-2 border-t bg-background px-5 py-4">
        <Button variant="outline" onClick={() => onSave("draft")} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save draft</Button>
        <Button variant="secondary" onClick={() => onSave("scheduled")} disabled={saving}><CalendarClock className="mr-2 h-4 w-4" />Schedule post</Button>
        <Button onClick={() => onSave("publish")} disabled={saving}><Send className="mr-2 h-4 w-4" />Publish now</Button>
      </div>
    </div>
  </div>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>;
}

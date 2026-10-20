import { confirmDialog } from "@/components/admin/core/asyncDialogs";
import { useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import { listenCollection } from "@/hooks/useLiveCollection";
import { toast } from "sonner";
import {
  BookOpen,
  Plus,
  Search,
  CheckCircle2,
  Edit,
  Loader2,
  Tag,
  Wand2,
  Sparkles,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

interface KbArticle {
  id: string;
  title: string;
  content: string;
  category: string;
  role: string;
  tags: string[];
  status: "draft" | "published" | "archived";
  version: number;
  updatedAt?: any;
}

const CATEGORIES = [
  "All Categories",
  "Company Policies",
  "FAQs",
  "Restaurant Rules",
  "Delivery SOPs",
  "Refund Policies",
  "Feature Documentation",
];

export default function SupportKnowledgeBasePage() {
  const [articles, setArticles] = useState<KbArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCat, setSelectedCat] = useState("All Categories");
  const [selectedRole, setSelectedRole] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Modal states
  const [isOpen, setIsOpen] = useState(false);
  const [editingArticle, setEditingArticle] = useState<KbArticle | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [category, setCategory] = useState("FAQs");
  const [role, setRole] = useState("all");
  const [tagsInput, setTagsInput] = useState("");
  const [status, setStatus] = useState<"draft" | "published" | "archived">("published");
  const [saving, setSaving] = useState(false);

  // RAG Test Tool
  const [testQuery, setTestQuery] = useState("");
  const [testResults, setTestResults] = useState<any[]>([]);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    return listenCollection<KbArticle>(
      "knowledge_base_articles",
      { orderByField: "updatedAt", limit: 500 },
      (rows) => {
        setArticles(rows);
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, []);

  const openModal = (article?: KbArticle) => {
    if (article) {
      setEditingArticle(article);
      setTitle(article.title || "");
      setContent(article.content || "");
      setCategory(article.category || "FAQs");
      setRole(article.role || "all");
      setTagsInput(Array.isArray(article.tags) ? article.tags.join(", ") : "");
      setStatus(article.status || "published");
    } else {
      setEditingArticle(null);
      setTitle("");
      setContent("");
      setCategory("FAQs");
      setRole("all");
      setTagsInput("");
      setStatus("published");
    }
    setIsOpen(true);
  };

  const handleSave = async () => {
    if (!title.trim() || !content.trim()) {
      toast.error("Please fill in both title and content");
      return;
    }
    setSaving(true);
    try {
      const tags = tagsInput
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      if (editingArticle) {
        const fn = httpsCallable(functions, "updateKbArticle");
        await fn({
          id: editingArticle.id,
          title,
          content,
          category,
          role,
          tags,
          status,
        });
        toast.success("Article updated");
      } else {
        const fn = httpsCallable(functions, "createKbArticle");
        await fn({
          title,
          content,
          category,
          role,
          tags,
          status,
        });
        toast.success("Article created and published");
      }
      setIsOpen(false);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to save article");
    } finally {
      setSaving(false);
    }
  };

  const runRagTest = async () => {
    if (!testQuery.trim()) return;
    setTesting(true);
    try {
      // Semantic retrieval (embeddings + cosine) — mirrors what the bot uses.
      const fn = httpsCallable(functions, "previewKbRetrieval");
      const res = await fn({ query: testQuery, role: selectedRole, topK: 5 });
      const data = res.data as { results: any[] };
      setTestResults(data.results || []);
      if ((data.results || []).length === 0) {
        toast.message("No articles matched — try re-indexing or add KB content.");
      }
    } catch (err: any) {
      toast.error(err.message || "Retrieval test failed");
    } finally {
      setTesting(false);
    }
  };

  const [reindexing, setReindexing] = useState(false);
  const reindexEmbeddings = async () => {
    setReindexing(true);
    try {
      const fn = httpsCallable(functions, "reembedKbArticles");
      const res = await fn({ onlyMissing: false });
      const data = res.data as { embedded: number; total: number };
      toast.success(`Re-indexed ${data.embedded}/${data.total} articles for semantic search`);
    } catch (err: any) {
      toast.error(err.message || "Re-index failed");
    } finally {
      setReindexing(false);
    }
  };

  const [seeding, setSeeding] = useState(false);
  const seedStarterArticles = async () => {
    if (
      !(await confirmDialog({
        title: "Add Kada's starter knowledge base?",
        description: "Adds customer, rider and vendor help articles for Kada Assist. Articles already added are skipped.",
        confirmLabel: "Add articles",
      }))
    )
      return;
    setSeeding(true);
    try {
      const fn = httpsCallable(functions, "seedKnowledgeBase");
      const res = await fn({});
      const data = res.data as { created: number; skipped: number; total: number };
      toast.success(`Seeded ${data.created} new articles (${data.skipped} already present) of ${data.total}`);
    } catch (err: any) {
      toast.error(err.message || "Seeding failed");
    } finally {
      setSeeding(false);
    }
  };

  const filteredArticles = articles.filter((a) => {
    if (selectedCat !== "All Categories" && a.category !== selectedCat) return false;
    if (selectedRole !== "all" && a.role !== selectedRole && a.role !== "all") return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const t = (a.title || "").toLowerCase();
      const c = (a.content || "").toLowerCase();
      const tg = Array.isArray(a.tags) ? a.tags.join(" ").toLowerCase() : "";
      if (!t.includes(q) && !c.includes(q) && !tg.includes(q)) return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Knowledge base</h2>
          <p className="text-xs text-muted-foreground mt-1 font-bold uppercase tracking-widest flex items-center gap-2">
            <BookOpen className="h-3.5 w-3.5 text-primary" /> Grounding source for Kada Assist AI across all mobile apps
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            onClick={seedStarterArticles}
            disabled={seeding}
            className="rounded-2xl gap-2 font-bold px-5"
            title="Add Kada's starter knowledge base for customer, rider & vendor apps"
          >
            <BookOpen className={`h-4 w-4 ${seeding ? "animate-pulse" : ""}`} />
            {seeding ? "Seeding…" : "Seed starter KB"}
          </Button>
          <Button
            variant="outline"
            onClick={reindexEmbeddings}
            disabled={reindexing}
            className="rounded-2xl gap-2 font-bold px-5"
            title="Rebuild vector embeddings so semantic search stays fresh"
          >
            <Sparkles className={`h-4 w-4 ${reindexing ? "animate-pulse" : ""}`} />
            {reindexing ? "Re-indexing…" : "Re-index RAG"}
          </Button>
          <Button onClick={() => openModal()} className="rounded-2xl gap-2 font-black px-6 shadow-md">
            <Plus className="h-4 w-4" /> New KB Article
          </Button>
        </div>
      </div>

      <Tabs defaultValue="articles" className="space-y-6">
        <TabsList className="rounded-2xl bg-card border border-border/60 p-1">
          <TabsTrigger value="articles" className="rounded-xl font-bold px-5">
            Articles & Policies ({filteredArticles.length})
          </TabsTrigger>
          <TabsTrigger value="rag_test" className="rounded-xl font-bold px-5 gap-1.5">
            <Wand2 className="h-3.5 w-3.5 text-violet-500" /> RAG Retrieval Test Tool
          </TabsTrigger>
        </TabsList>

        <TabsContent value="articles" className="space-y-6">
          {/* Filters Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-3xl bg-card border border-border/40 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold text-muted-foreground mr-1">Category:</span>
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCat(cat)}
                  className={`rounded-xl px-3 py-1.5 text-xs font-bold transition-all ${
                    selectedCat === cat
                      ? "bg-primary text-primary-foreground shadow-sm font-extrabold"
                      : "bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter articles..."
                  className="rounded-xl border border-border/60 bg-background pl-9 pr-4 py-2 text-xs font-medium outline-none focus:ring-1 focus:ring-ring w-60"
                />
              </div>
            </div>
          </div>

          {/* Articles Grid */}
          {loading ? (
            <div className="flex items-center justify-center p-20">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : filteredArticles.length === 0 ? (
            <Card className="rounded-3xl border-border/40 p-16 text-center">
              <p className="text-sm font-bold text-muted-foreground uppercase tracking-widest">
                No articles match your filters
              </p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredArticles.map((art) => (
                <Card key={art.id} className="rounded-3xl border-border/40 overflow-hidden flex flex-col shadow-sm hover:shadow-md transition-shadow">
                  <CardContent className="p-6 flex-1 flex flex-col justify-between gap-4">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <Badge variant="outline" className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 border-primary/30 text-primary bg-primary/5">
                          {art.category}
                        </Badge>
                        <Badge
                          variant="outline"
                          className={`text-[9px] font-semibold uppercase px-2 py-0.5 ${
                            art.status === "published"
                              ? "border-emerald-500/30 text-emerald-600 bg-emerald-500/10"
                              : "border-border text-muted-foreground"
                          }`}
                        >
                          {art.status}
                        </Badge>
                      </div>

                      <h3 className="font-black text-base leading-snug text-foreground">{art.title}</h3>
                      <p className="text-xs text-muted-foreground line-clamp-4 leading-relaxed whitespace-pre-wrap">
                        {art.content}
                      </p>
                    </div>

                    <div className="space-y-3 pt-3 border-t border-border/40">
                      <div className="flex flex-wrap gap-1">
                        <Badge variant="secondary" className="text-[9px] font-bold">
                          Role: {art.role}
                        </Badge>
                        <Badge variant="secondary" className="text-[9px] font-bold">
                          v{art.version || 1}
                        </Badge>
                        {Array.isArray(art.tags) &&
                          art.tags.slice(0, 3).map((tag, i) => (
                            <Badge key={i} variant="outline" className="text-[9px] font-medium text-muted-foreground">
                              #{tag}
                            </Badge>
                          ))}
                      </div>

                      <div className="flex justify-end">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openModal(art)}
                          className="rounded-xl text-xs font-bold gap-1"
                        >
                          <Edit className="h-3.5 w-3.5" /> Edit Article
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* RAG Test Tool Tab */}
        <TabsContent value="rag_test" className="space-y-6">
          <Card className="rounded-3xl border-border/40 p-6 space-y-4 shadow-sm">
            <div>
              <h3 className="font-black text-lg">Test Semantic & Keyword Knowledge Base Retrieval</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Enter a sample question that a customer, vendor, or delivery partner might ask in their chat. See what context articles Kada Assist will retrieve and ground its response on.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <input
                value={testQuery}
                onChange={(e) => setTestQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runRagTest()}
                placeholder="e.g. Can I get a refund if it rains during delivery?"
                className="flex-1 rounded-2xl border border-border/60 bg-background px-4 py-3 text-sm font-medium outline-none focus:ring-2 focus:ring-ring"
              />
              <Button onClick={runRagTest} disabled={testing || !testQuery.trim()} className="rounded-2xl px-6 font-bold h-11 gap-2">
                {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                Test RAG Retrieval
              </Button>
            </div>

            {testResults.length > 0 && (
              <div className="space-y-3 pt-4 border-t border-border/40">
                <h4 className="font-semibold text-xs uppercase tracking-wide text-violet-500">
                  Retrieved Articles ({testResults.length})
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {testResults.map((res) => (
                    <div key={res.id} className="p-4 rounded-2xl bg-muted/40 border border-border/60 space-y-2">
                      <div className="flex items-center justify-between">
                        <Badge variant="outline" className="text-[10px] font-bold border-violet-500/30 text-violet-600 bg-violet-500/10">
                          {res.category}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground font-mono">Role: {res.role}</span>
                      </div>
                      <h5 className="font-black text-sm">{res.title}</h5>
                      <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">{res.content}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>
        </TabsContent>
      </Tabs>

      {/* Modal for Create/Edit Article */}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="sm:max-w-xl rounded-3xl p-6">
          <DialogHeader>
            <DialogTitle className="font-black text-xl">
              {editingArticle ? "Edit KB Article" : "Create New Knowledge Base Article"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-3">
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Article Title</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Standard Refund Policy & Eligibility"
                className="w-full rounded-xl border border-border/60 bg-background px-3.5 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Category</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full rounded-xl border border-border/60 bg-background px-3.5 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
                >
                  {CATEGORIES.filter((c) => c !== "All Categories").map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Target Role</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full rounded-xl border border-border/60 bg-background px-3.5 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="all">All Roles (Customer, Vendor, Rider, Host)</option>
                  <option value="customer">Customer Only</option>
                  <option value="vendor">Vendor Only</option>
                  <option value="rider">Delivery Partner Only</option>
                  <option value="host">Host / Kada Stay Only</option>
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Content (Markdown supported)</label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={6}
                placeholder="Provide clear, step-by-step policy explanations or answers..."
                className="w-full rounded-xl border border-border/60 bg-background px-3.5 py-2 text-sm outline-none focus:ring-1 focus:ring-ring resize-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Tags (comma separated)</label>
                <input
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  placeholder="refund, rain, dispute, fee"
                  className="w-full rounded-xl border border-border/60 bg-background px-3.5 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as any)}
                  className="w-full rounded-xl border border-border/60 bg-background px-3.5 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="published">Published (Active in RAG)</option>
                  <option value="draft">Draft (Hidden)</option>
                  <option value="archived">Archived</option>
                </select>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setIsOpen(false)} className="rounded-xl font-bold">
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving} className="rounded-xl font-bold px-6">
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Save & Publish Article
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

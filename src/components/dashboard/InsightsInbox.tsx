import { useEffect, useState } from "react";
import { collection, query, orderBy, limit, onSnapshot, doc, updateDoc } from "firebase/firestore";
import { Sparkles, CheckCircle2, XCircle, AlertCircle, Loader2 } from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export interface AIInsight {
  id: string;
  title: string;
  description: string;
  type: "menu_engineering" | "pricing" | "stock";
  actionableItem?: string;
  isRead: boolean;
  createdAt: any;
}

export function InsightsInbox() {
  const { restaurantId, user } = useAuth();
  const [insights, setInsights] = useState<AIInsight[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !restaurantId || restaurantId === 'global') {
      setInsights([]);
      setLoading(false);
      return;
    }

    const targetId = restaurantId;

    const q = query(
      collection(db, `restaurants/${targetId}/ai_insights`),
      orderBy("createdAt", "desc"),
      limit(5)
    );

    const unsubscribe = onSnapshot(q, (snap) => {
      const data = snap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as AIInsight[];
      setInsights(data);
      setLoading(false);
    }, (err) => console.error("[InsightsInbox] q listener failed", err));

    return () => unsubscribe();
  }, [user, restaurantId]);

  const markAsRead = async (id: string) => {
    if (restaurantId === 'global') return;
    try {
      await updateDoc(doc(db, `restaurants/${restaurantId}/ai_insights/${id}`), {
        isRead: true
      });
    } catch (e) {
      console.error("Failed to mark as read", e);
    }
  };

  const executeInsight = async (insight: AIInsight) => {
    if (restaurantId === 'global') return;
    setActing(insight.id);
    // In a real app, this would dispatch to specific cloud functions based on `type`.
    // For now, we simulate execution and mark as read.
    try {
      await new Promise(resolve => setTimeout(resolve, 800));
      await updateDoc(doc(db, `restaurants/${restaurantId}/ai_insights/${insight.id}`), {
        isRead: true,
        executed: true
      });
      toast.success(`Executed AI action: ${insight.title}`);
    } catch (e) {
      toast.error("Failed to execute action");
    } finally {
      setActing(null);
    }
  };

  if (loading) {
    return (
      <div className="rounded-3xl border border-border/40 bg-card p-6 shadow-sm flex items-center justify-center min-h-[150px]">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (insights.length === 0) {
    return (
      <div className="rounded-3xl border border-border/40 bg-card p-6 shadow-sm flex flex-col items-center justify-center min-h-[150px] text-center">
        <Sparkles className="h-6 w-6 text-muted-foreground/40 mb-2" />
        <p className="text-sm font-bold text-muted-foreground">No new AI insights</p>
        <p className="text-xs text-muted-foreground/60 mt-1">Check back later for automated recommendations.</p>
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-violet-500/20 bg-gradient-to-b from-violet-500/5 to-transparent overflow-hidden">
      <div className="px-5 py-4 border-b border-violet-500/10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-xl bg-violet-500/20 flex items-center justify-center text-violet-600">
            <Sparkles className="h-4 w-4" />
          </div>
          <h3 className="text-sm font-black tracking-tight text-violet-950 dark:text-violet-100">
            AI Insights Inbox
          </h3>
        </div>
        <div className="px-2 py-0.5 rounded-full bg-violet-500 text-white text-[10px] font-black uppercase tracking-widest">
          {insights.filter(i => !i.isRead).length} New
        </div>
      </div>
      <div className="divide-y divide-violet-500/10">
        {insights.map((insight) => (
          <div key={insight.id} className={cn("p-4 transition-colors hover:bg-violet-500/5", insight.isRead && "opacity-60")}>
            <div className="flex items-start gap-3">
              <div className="mt-0.5">
                {insight.type === 'menu_engineering' && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                {insight.type === 'pricing' && <Sparkles className="h-4 w-4 text-amber-500" />}
                {insight.type === 'stock' && <AlertCircle className="h-4 w-4 text-destructive" />}
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-bold text-foreground">{insight.title}</h4>
                <p className="text-xs text-muted-foreground font-medium mt-1">{insight.description}</p>
                {insight.actionableItem && (
                  <p className="text-[10px] font-bold text-violet-600 mt-2 bg-violet-500/10 inline-block px-2 py-0.5 rounded-md">
                    Target: {insight.actionableItem}
                  </p>
                )}
                {!insight.isRead && (
                  <div className="flex gap-2 mt-3">
                    <Button
                      size="sm"
                      onClick={() => executeInsight(insight)}
                      disabled={acting === insight.id}
                      className="h-7 rounded-lg text-[10px] font-black uppercase tracking-widest bg-violet-600 hover:bg-violet-700 text-white"
                    >
                      {acting === insight.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Apply"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => markAsRead(insight.id)}
                      className="h-7 rounded-lg text-[10px] font-black uppercase tracking-widest hover:text-destructive"
                    >
                      Dismiss
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

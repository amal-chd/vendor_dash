import { useMemo, useState } from "react";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { parseChangelogMarkdown } from "@/lib/changelogMarkdown";
import { changelogAdmin, errorMessage, type Audience, type EntryType } from "@/lib/changelog";
import { ChangelogBlocks } from "./ChangelogBlocks";

interface Draft {
  title: string;
  summary: string;
  body: string;
}

/**
 * Turn raw notes — commit messages, a ticket, a Slack thread — into a release
 * note. The model is instructed to use only facts in the notes; the preview is
 * shown before anything touches the editor, so a human always reads it first.
 */
export function AiDraftDialog({
  open,
  onOpenChange,
  type,
  audiences,
  hasContent,
  onUse,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: EntryType;
  audiences: Audience[];
  hasContent: boolean;
  onUse: (draft: Draft) => void;
}) {
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Draft | null>(null);
  const blocks = useMemo(() => (result ? parseChangelogMarkdown(result.body) : []), [result]);

  const generate = async () => {
    setBusy(true);
    try {
      const res = await changelogAdmin<{ draft: Draft }>("aiDraft", { notes, type, audiences });
      setResult(res.draft);
    } catch (e) {
      toast.error(errorMessage(e, "AI drafting didn't work this time."));
    } finally {
      setBusy(false);
    }
  };

  const close = (next: boolean) => {
    if (!next) {
      setResult(null);
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> Draft with AI
          </DialogTitle>
          <DialogDescription>
            Paste what changed — commit messages, a ticket or rough bullets. The draft uses only what you
            paste, and you review it before it goes into the editor.
          </DialogDescription>
        </DialogHeader>

        {!result ? (
          <div className="space-y-2">
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={
                "fix: rider OTP no longer rejected after app restart\nfeat(checkout): pay for delivery fee with Kada Gold points\nperf: menu loads 40% faster on 3G"
              }
              className="min-h-[180px] font-mono text-[13px]"
              maxLength={6000}
            />
            <p className="text-right text-[11px] text-muted-foreground tabular-nums">{notes.length} / 6000</p>
          </div>
        ) : (
          <div className="max-h-[55vh] space-y-3 overflow-y-auto rounded-xl border border-border bg-muted/20 p-4">
            <h3 className="text-lg font-bold tracking-tight">{result.title}</h3>
            <p className="text-sm text-muted-foreground">{result.summary}</p>
            <ChangelogBlocks blocks={blocks} density="compact" />
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {!result ? (
            <Button onClick={generate} disabled={busy || notes.trim().length < 15}>
              {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4" />}
              Write draft
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setResult(null)}>
                Edit notes
              </Button>
              <Button variant="outline" onClick={generate} disabled={busy}>
                {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
                Try again
              </Button>
              <Button
                onClick={() => {
                  onUse(result);
                  close(false);
                }}
              >
                {hasContent ? "Replace editor text" : "Use this draft"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

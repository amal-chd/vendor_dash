import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle } from "lucide-react";

/**
 * Promise-returning replacements for window.confirm / window.prompt.
 *
 * The browser dialogs block the whole tab, ignore the theme, can't say which
 * action is destructive, and on some browsers carry a "prevent this page from
 * creating more dialogs" checkbox that silently turns every later confirm into
 * `false` — a dead button. These render the console's own dialog instead, so a
 * call site stays a one-line swap:
 *
 *   if (!(await confirmDialog({ title: "Delete this zone?", destructive: true }))) return;
 *   const reason = await promptDialog({ title: "Why suspend?", required: true });
 *
 * `<AsyncDialogHost />` is mounted once in AdminLayout.
 */

export interface ConfirmOptions {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button + warning icon. */
  destructive?: boolean;
}

export interface PromptOptions extends ConfirmOptions {
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  /** Confirm stays disabled until something is typed. */
  required?: boolean;
  multiline?: boolean;
  inputMode?: "text" | "decimal" | "numeric";
  /** Return an error message to block confirming, or null when the value is fine. */
  validate?: (value: string) => string | null;
}

type Request =
  | { kind: "confirm"; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: "prompt"; opts: PromptOptions; resolve: (v: string | null) => void };

let enqueue: ((r: Request) => void) | null = null;

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  // Only reachable before the host mounts (or in a unit test): degrade to the
  // browser dialog rather than silently refusing the action.
  if (!enqueue) return Promise.resolve(window.confirm(opts.title));
  return new Promise((resolve) => enqueue!({ kind: "confirm", opts, resolve }));
}

export function promptDialog(opts: PromptOptions): Promise<string | null> {
  if (!enqueue) return Promise.resolve(window.prompt(opts.title, opts.defaultValue ?? ""));
  return new Promise((resolve) => enqueue!({ kind: "prompt", opts, resolve }));
}

export function AsyncDialogHost() {
  const [queue, setQueue] = useState<Request[]>([]);
  const [value, setValue] = useState("");
  const inputId = useId();
  const current = queue[0];
  const settled = useRef(false);

  useEffect(() => {
    enqueue = (r) => setQueue((q) => [...q, r]);
    return () => {
      enqueue = null;
    };
  }, []);

  useEffect(() => {
    settled.current = false;
    setValue(current?.kind === "prompt" ? current.opts.defaultValue ?? "" : "");
  }, [current]);

  if (!current) return null;
  const { opts } = current;
  const isPrompt = current.kind === "prompt";
  const p = isPrompt ? (opts as PromptOptions) : null;
  const error = p?.validate && value ? p.validate(value) : null;
  const blocked = !!p && ((p.required && !value.trim()) || !!error);

  const finish = (ok: boolean) => {
    if (settled.current) return;
    settled.current = true;
    if (current.kind === "confirm") current.resolve(ok);
    else current.resolve(ok ? value.trim() : null);
    setQueue((q) => q.slice(1));
  };

  return (
    <AlertDialog open onOpenChange={(open) => !open && finish(false)}>
      <AlertDialogContent className="max-w-md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!blocked) finish(true);
          }}
          className="space-y-4"
        >
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-start gap-2 leading-snug">
              {opts.destructive && <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />}
              {opts.title}
            </AlertDialogTitle>
            {opts.description && (
              <AlertDialogDescription className="text-sm text-muted-foreground">{opts.description}</AlertDialogDescription>
            )}
          </AlertDialogHeader>

          {p && (
            <div className="space-y-1.5">
              {p.label && <Label htmlFor={inputId}>{p.label}</Label>}
              {p.multiline ? (
                <Textarea
                  id={inputId}
                  autoFocus
                  value={value}
                  placeholder={p.placeholder}
                  onChange={(e) => setValue(e.target.value)}
                  className="min-h-[88px] resize-none"
                />
              ) : (
                <Input
                  id={inputId}
                  autoFocus
                  value={value}
                  inputMode={p.inputMode}
                  placeholder={p.placeholder}
                  onChange={(e) => setValue(e.target.value)}
                />
              )}
              {error && <p className="text-xs text-destructive">{error}</p>}
            </div>
          )}

          <AlertDialogFooter>
            <Button type="button" variant="outline" onClick={() => finish(false)}>
              {opts.cancelLabel ?? "Cancel"}
            </Button>
            <Button type="submit" variant={opts.destructive ? "destructive" : "default"} disabled={blocked} autoFocus={!isPrompt}>
              {opts.confirmLabel ?? "Confirm"}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

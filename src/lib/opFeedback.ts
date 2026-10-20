import { toast } from "sonner";

/**
 * Run a write and tell the operator what actually happened.
 *
 * The console was full of handlers shaped like this:
 *
 *     onClick={async () => {
 *       await updateDoc(ref, { kycStatus: "approved" });
 *       toast.success("Host KYC approved");
 *     }}
 *
 * When the write is rejected — a rules change, a stale document, no network —
 * the throw escapes into an unhandled promise rejection. The success toast
 * never fires, so the button appears to do nothing at all, and the operator's
 * reasonable conclusion is that they mis-clicked. They click again. The record
 * they believe they changed is unchanged, and nothing anywhere said so.
 *
 * Handlers that also set a busy flag were worse: the flag was cleared after
 * the await, so a failure left the control disabled until the page remounted.
 *
 * `runOp` reports both outcomes and always clears the busy flag.
 */
export async function runOp(
  fn: () => Promise<unknown>,
  success: string,
  opts: { failure?: string; busy?: (b: boolean) => void } = {},
): Promise<boolean> {
  opts.busy?.(true);
  try {
    await fn();
    toast.success(success);
    return true;
  } catch (e: unknown) {
    const raw = e instanceof Error ? e.message : "";
    const code = ((e as { code?: string }).code ?? "").replace(/^(functions|firestore|auth)\//, "");
    // Firestore's own wording ("Missing or insufficient permissions") tells an
    // operator nothing about what to do, so name the likely cause instead.
    const message =
      code === "permission-denied"
        ? "You don't have permission to do that (or a security rule refused it). Nothing was changed."
        : code === "not-found"
          ? "That record no longer exists — it may have been deleted. Nothing was changed."
          : code === "unavailable" || code === "deadline-exceeded"
            ? "Couldn't reach Kada. Check your connection, then try again — nothing was changed."
            : raw || "That didn't go through. Nothing was changed.";
    toast.error(`${opts.failure ?? "Failed"}: ${message}`, { duration: 7000 });
    console.error(`[runOp] ${opts.failure ?? success} failed`, e);
    return false;
  } finally {
    opts.busy?.(false);
  }
}

import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

/**
 * Web subscription checkout — the Razorpay replacement for in-app purchase.
 *
 * Kada Dine and Kada Host are B2B business software, so under App Review
 * guideline 3.1.3(e) (Enterprise Services) the subscription is sold here on the
 * web and the mobile apps are pure entitlement clients. The apps therefore
 * carry no purchase UI at all.
 *
 * The AMOUNT IS DECIDED SERVER-SIDE from the plan catalog — this module only
 * names a plan and a billing period. It can never send a price.
 */
declare global {
  interface Window {
    Razorpay: any;
  }
}

function loadRazorpay(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.Razorpay) return resolve();
    const existing = document.querySelector('script[src*="checkout.razorpay.com"]');
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Failed to load Razorpay")));
      return;
    }
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load Razorpay"));
    document.head.appendChild(s);
  });
}

export interface CheckoutArgs {
  product: "dine" | "stay";
  planId: string;
  period: "monthly" | "yearly";
  prefill?: { name?: string; email?: string; contact?: string };
}

/**
 * Runs the full purchase. Resolves with `null` on success, or a human-readable
 * error string. Activation happens server-side: immediately via the
 * signature-checked `confirm` call, or via the webhook if that call fails. A
 * resolved promise means "paid"; the caller should still let the subscription
 * status stream update rather than assuming entitlement locally.
 */
export async function startSubscriptionCheckout(args: CheckoutArgs): Promise<string | null> {
  try {
    const res = await httpsCallable(functions, "createSubscriptionOrder")({
      product: args.product,
      planId: args.planId,
      period: args.period,
    });
    const d = res.data as {
      razorpayOrderId: string;
      amount: number;
      keyId: string;
      planName: string;
      period: string;
    };

    await loadRazorpay();

    return await new Promise<string | null>((resolve) => {
      const rzp = new window.Razorpay({
        key: d.keyId,
        order_id: d.razorpayOrderId,
        amount: d.amount * 100,
        currency: "INR",
        name: "The Kada",
        description: `${d.planName} · ${d.period === "yearly" ? "12 months" : "1 month"}`,
        prefill: args.prefill ?? {},
        theme: { color: "#2563EB" },
        handler: async (r: { razorpay_order_id?: string; razorpay_payment_id?: string; razorpay_signature?: string }) => {
          // Activate now rather than waiting on the webhook. The server
          // checks the signature AND that Razorpay captured the catalog price.
          // If the browser call fails, the webhook still activates the plan.
          const confirm = httpsCallable(functions, "createSubscriptionOrder");
          const payload = {
            confirm: {
              razorpayOrderId: r?.razorpay_order_id ?? d.razorpayOrderId,
              razorpayPaymentId: r?.razorpay_payment_id ?? "",
              razorpaySignature: r?.razorpay_signature ?? "",
            },
          };
          let last: unknown;
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              await confirm(payload);
              resolve(null);
              return;
            } catch (err) {
              last = err;
              await new Promise((wait) => setTimeout(wait, 800 * (attempt + 1)));
            }
          }
          console.error("Subscription confirm failed; webhook will finish it", last);
          resolve("Payment received. Your plan will activate in a few seconds.");
        },
        modal: {
          ondismiss: () => resolve("Payment cancelled."),
        },
      });
      rzp.on("payment.failed", (r: any) =>
        resolve(r?.error?.description ?? "Payment failed. Please try again."),
      );
      rzp.open();
    });
  } catch (e: any) {
    // Server-side messages are meaningful (unknown plan, sales-led plan, etc.).
    return e?.message ?? "Could not start the payment. Please try again.";
  }
}

/**
 * Stop (or undo stopping) a subscription at the end of the paid period.
 * Time already paid for is never cut short; once it ends the merchant falls
 * back to commission billing. Resolves with null on success or an error.
 */
export async function setSubscriptionCancellation(
  product: "dine" | "stay",
  cancel: boolean,
): Promise<string | null> {
  try {
    await httpsCallable(functions, "createSubscriptionOrder")({ action: cancel ? "cancel" : "resume", product });
    return null;
  } catch (e: any) {
    return e?.message ?? "Couldn't update your subscription. Please try again.";
  }
}

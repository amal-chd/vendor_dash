import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

/**
 * Client helpers for the RazorpayX payout system. All money movement happens
 * server-side (functions/src/payouts.ts) — these just invoke the callables.
 */

export type PayoutKind = "vendor" | "rider" | "host" | "mess";

export interface PayoutConfig {
  configured: boolean;
  hasKeys: boolean;
  hasAccountNumber: boolean;
  keyIdMasked: string | null;
  live: boolean;
}

export async function fetchPayoutConfig(): Promise<PayoutConfig> {
  const fn = httpsCallable(functions, "getPayoutConfig");
  const res = await fn({});
  const d = res.data as Partial<PayoutConfig>;
  return {
    configured: !!d.configured,
    hasKeys: !!d.hasKeys,
    hasAccountNumber: !!d.hasAccountNumber,
    keyIdMasked: d.keyIdMasked ?? null,
    live: !!d.live,
  };
}

export interface DisburseResult {
  success: boolean;
  payoutId: string;
  status: string;
  referenceId: string;
  amount: number;
}

/** Disburse a single settlement / payout request via RazorpayX. */
export async function disbursePayout(kind: PayoutKind, id: string): Promise<DisburseResult> {
  const fn = httpsCallable(functions, "disbursePayout");
  const res = await fn({ kind, id });
  return res.data as DisburseResult;
}

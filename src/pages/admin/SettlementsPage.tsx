import { useEffect, useMemo, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { Wallet, CheckSquare, Download, Settings2, FileSpreadsheet, Zap, AlertTriangle } from "lucide-react";
import { fetchPayoutConfig, disbursePayout, type PayoutConfig } from "@/lib/payouts";
import { ColumnDef } from "@tanstack/react-table";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { DataTable } from "@/components/admin/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { StatCards } from "@/components/admin/StatCards";
import { useLiveCollection } from "@/hooks/useLiveCollection";
import { serverTimestamp, collection, addDoc, doc, getDoc } from "firebase/firestore";
import { db, functions } from "@/lib/firebase";
import { PARTNER_PRIVATE_COLLECTION, partnerDocKey, type PartnerPrivate } from "@/lib/onboarding";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Settlement {
  id: string;
  restaurantId?: string;
  restaurantName?: string;
  periodStart?: string;
  periodEnd?: string;
  orderCount?: number;
  grossSales?: number;
  refundOffsets?: number;
  commissionAmount?: number;
  gatewayFee?: number;
  tdsAmount?: number;
  tcsAmount?: number;
  adDeductions?: number;
  adjustmentsTotal?: number;
  netPayout?: number;
  status?: string;
  utrNumber?: string;
  bankDetails?: {
    accountNumber?: string;
    ifsc?: string;
    accountName?: string;
  };
}

const inr = (n?: number) => `₹${Math.round(n || 0).toLocaleString("en-IN")}`;

export default function SettlementsPage() {
  const vendors = useLiveCollection<Settlement>("vendor_settlements", { orderByField: "createdAt" });
  const [utr, setUtr] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState("pending");
  const [payoutCfg, setPayoutCfg] = useState<PayoutConfig | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);

  useEffect(() => {
    fetchPayoutConfig().then(setPayoutCfg).catch(() => setPayoutCfg(null));
  }, []);

  // Disburse a single vendor settlement via RazorpayX. The live listener flips
  // the row to `processing` (then `paid` once the payout webhook confirms).
  const payViaRazorpay = async (id: string) => {
    setPayingId(id);
    try {
      const r = await disbursePayout("vendor", id);
      toast.success(`Payout initiated (₹${r.amount}) — ${r.status}. UTR arrives on completion.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Payout failed");
    } finally {
      setPayingId(null);
    }
  };

  // Adjustment Dialog State
  const [adjOpen, setAdjOpen] = useState(false);
  const [adjRestId, setAdjRestId] = useState("");
  const [adjRestName, setAdjRestName] = useState("");
  const [adjType, setAdjType] = useState("debit");
  const [adjAmount, setAdjAmount] = useState("");
  const [adjReason, setAdjReason] = useState("");

  const pendingSettlements = useMemo(() => vendors.rows.filter((s) => s.status !== "paid"), [vendors.rows]);
  const paidSettlements = useMemo(() => vendors.rows.filter((s) => s.status === "paid"), [vendors.rows]);

  const totalPending = pendingSettlements.reduce((sum, s) => sum + (s.netPayout || 0), 0);
  const totalTaxWithheld = pendingSettlements.reduce((sum, s) => sum + (s.tdsAmount || 0) + (s.tcsAmount || 0), 0);
  const totalAdjustments = pendingSettlements.reduce((sum, s) => sum + (s.adjustmentsTotal || 0), 0);

  // Bulk disbursement via RazorpayX — routes every selected settlement through
  // the server callable (never a direct client status flip). Each is idempotent
  // and processed independently so one failure doesn't abort the run.
  const processBulk = async () => {
    if (!selectedIds.length) return;
    if (!payoutCfg?.configured) {
      toast.error("RazorpayX isn't configured yet — set RAZORPAY_ACCOUNT_NUMBER to enable payouts.");
      return;
    }
    toast.info(`Initiating ${selectedIds.length} RazorpayX payouts…`);
    let ok = 0;
    let failed = 0;
    for (const id of selectedIds) {
      try {
        await disbursePayout("vendor", id);
        ok++;
      } catch {
        failed++;
      }
    }
    if (ok) toast.success(`${ok} payout${ok > 1 ? "s" : ""} initiated${failed ? `, ${failed} failed` : ""}`);
    else toast.error(`All ${failed} payouts failed`);
    setSelectedIds([]);
  };

  const exportBankCSV = async () => {
    const toExport = pendingSettlements.filter(s => selectedIds.includes(s.id) || selectedIds.length === 0);
    if (!toExport.length) return toast.error("No pending settlements to export");

    // Full account details live in partner_private (finance-grade admins
    // only); settlement docs carry just a masked summary.
    const vendorIds = Array.from(new Set(toExport.map((s) => s.restaurantId).filter(Boolean))) as string[];
    const privates = new Map<string, PartnerPrivate>();
    try {
      await Promise.all(
        vendorIds.map(async (rid) => {
          const snap = await getDoc(doc(db, PARTNER_PRIVATE_COLLECTION, partnerDocKey("vendor", rid)));
          if (snap.exists()) privates.set(rid, snap.data() as PartnerPrivate);
        }),
      );
    } catch {
      return toast.error("Your admin role can't read bank details. Ask a finance admin to export.");
    }

    // Standard Bank Bulk Upload Format (e.g., RazorpayX / ICICI)
    const headers = ["Account Number", "IFSC", "Amount", "Name", "Remarks"];
    let missing = 0;
    const rows = toExport.map(s => {
      const p = s.restaurantId ? privates.get(s.restaurantId)?.bank : undefined;
      // Settlements generated before the private store carried a copy.
      const legacy = s.bankDetails || {};
      const account = p?.accountNumber || legacy.accountNumber || "";
      if (!account) missing++;
      return [
        account,
        p?.ifsc || legacy.ifsc || "",
        s.netPayout || 0,
        p?.holder || legacy.accountName || s.restaurantName || "",
        `Settlement ${s.periodStart?.split("T")[0] || ""}`
      ].join(",");
    });
    if (missing) toast.warning(`${missing} settlement(s) have no bank account on file.`);

    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `payouts_${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
  };

  const handleAddAdjustment = async () => {
    if (!adjAmount || isNaN(Number(adjAmount))) return toast.error("Invalid amount");
    try {
      const amount = adjType === "debit" ? -Math.abs(Number(adjAmount)) : Math.abs(Number(adjAmount));
      await addDoc(collection(db, "vendor_adjustments"), {
        restaurantId: adjRestId,
        restaurantName: adjRestName,
        amount,
        reason: adjReason,
        status: "pending",
        createdAt: serverTimestamp(),
        createdBy: "admin", // Ideally from auth
      });
      toast.success("Adjustment added. Will be applied to the next settlement generation.");
      setAdjOpen(false);
      setAdjAmount("");
      setAdjReason("");
    } catch (e) {
      toast.error("Failed to add adjustment");
    }
  };

  const vCols: ColumnDef<Settlement>[] = useMemo(
    () => [
      {
        id: "select",
        header: ({ table }) => (
          <Checkbox
            checked={table.getIsAllPageRowsSelected()}
            onCheckedChange={(val) => {
              table.toggleAllPageRowsSelected(!!val);
              if (val) {
                setSelectedIds(table.getRowModel().rows.map(r => r.original.id));
              } else {
                setSelectedIds([]);
              }
            }}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={selectedIds.includes(row.original.id)}
            onCheckedChange={(val) => {
              if (val) setSelectedIds(p => [...p, row.original.id]);
              else setSelectedIds(p => p.filter(id => id !== row.original.id));
            }}
          />
        ),
      },
      { accessorKey: "restaurantName", header: "Vendor" },
      { accessorKey: "grossSales", header: "Gross Sales", cell: ({ row }) => inr(row.original.grossSales) },
      {
        accessorKey: "refundOffsets",
        header: "Refunds",
        cell: ({ row }) => row.original.refundOffsets
          ? <span className="text-amber-600" title="Amount deducted from gross for partial/full refunds">-{inr(row.original.refundOffsets)}</span>
          : "—",
      },
      { accessorKey: "commissionAmount", header: "Comm.", cell: ({ row }) => <span className="text-rose-600">-{inr(row.original.commissionAmount)}</span> },
      { 
        id: "taxes", 
        header: "TDS/TCS", 
        cell: ({ row }) => {
          const totalTaxes = (row.original.tdsAmount || 0) + (row.original.tcsAmount || 0);
          return <span className="text-amber-600">-{inr(totalTaxes)}</span>;
        } 
      },
      { accessorKey: "gatewayFee", header: "Gateway", cell: ({ row }) => <span className="text-rose-600">-{inr(row.original.gatewayFee)}</span> },
      { accessorKey: "adDeductions", header: "Ads", cell: ({ row }) => row.original.adDeductions ? <span className="text-rose-600">-{inr(row.original.adDeductions)}</span> : "—" },
      { 
        accessorKey: "adjustmentsTotal", 
        header: "Adjustments", 
        cell: ({ row }) => {
          const adj = row.original.adjustmentsTotal || 0;
          if (adj === 0) return "—";
          return <span className={adj > 0 ? "text-emerald-600" : "text-rose-600"}>{adj > 0 ? "+" : ""}{inr(adj)}</span>;
        } 
      },
      { accessorKey: "netPayout", header: "Final Payable", cell: ({ row }) => <span className="font-bold text-emerald-600">{inr(row.original.netPayout)}</span> },
      { accessorKey: "status", header: "Status", cell: ({ row }) => <Badge variant="outline">{row.original.status}</Badge> },
      {
        id: "actions",
        cell: ({ row }) => {
          const s = row.original;
          const isPending = s.status !== "paid" && s.status !== "processing";
          return (
            <div className="flex justify-end gap-1">
              {isPending && (
                <Button
                  size="sm"
                  className="h-8 bg-primary/90 hover:bg-primary"
                  disabled={payingId === s.id || !payoutCfg?.configured}
                  title={payoutCfg?.configured ? "Disburse via RazorpayX" : "RazorpayX not configured"}
                  onClick={() => payViaRazorpay(s.id)}
                >
                  <Zap className="h-3.5 w-3.5 mr-1" />
                  {payingId === s.id ? "Paying…" : "Pay"}
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setAdjRestId(s.restaurantId || "");
                  setAdjRestName(s.restaurantName || "Vendor");
                  setAdjOpen(true);
                }}
              >
                <Settings2 className="h-4 w-4" />
              </Button>
            </div>
          );
        },
      }
    ],
    [selectedIds, payingId, payoutCfg]
  );

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Settlements Hub"
        description="Expanded vendor settlements with TDS/TCS tax withholding, manual adjustments, and bulk bank CSV exports."
        icon={Wallet}
        actions={
          <div className="flex flex-wrap gap-2 items-center">
            {selectedIds.length > 0 && (
              <Button onClick={processBulk} className="bg-emerald-600 hover:bg-emerald-700">
                <Zap className="h-4 w-4 mr-2" /> Pay {selectedIds.length} via RazorpayX
              </Button>
            )}
            <Input placeholder="Bulk UTR (manual export)" value={utr} onChange={(e) => setUtr(e.target.value)} className="w-40" />
            <Button variant="outline" onClick={exportBankCSV} className="gap-2">
              <FileSpreadsheet className="h-4 w-4" /> Export CSV
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  const fn = httpsCallable(functions, "generateVendorSettlements");
                  const res = await fn({});
                  toast.success(`Generated ${(res.data as { count?: number }).count ?? 0} vendor settlements`);
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Deploy generateVendorSettlements to generate new weeks");
                }
              }}
            >
              Generate Weekly Cycle
            </Button>
          </div>
        }
      />

      {payoutCfg && !payoutCfg.configured && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:border-amber-500/30 dark:text-amber-300">
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" />
          <div>
            <p className="font-semibold">RazorpayX payouts not fully configured</p>
            <p className="text-amber-800/90">
              {payoutCfg.hasKeys
                ? "Razorpay keys are set, but the source account number (RAZORPAY_ACCOUNT_NUMBER) is missing. Add it to enable one-click disbursals. Until then, use Export CSV for a manual bank upload."
                : "Razorpay keys aren't set on the server. Payouts are disabled until the keys and source account number are configured."}
            </p>
          </div>
        </div>
      )}
      {payoutCfg?.configured && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800 dark:bg-emerald-500/10 dark:border-emerald-500/30 dark:text-emerald-300">
          <Zap className="h-4 w-4 text-emerald-500" />
          <span>
            RazorpayX payouts live{payoutCfg.live ? "" : " (test mode)"} · key {payoutCfg.keyIdMasked}. Select rows and disburse in one click.
          </span>
        </div>
      )}

      <StatCards
        stats={[
          { label: "Pending payouts", value: inr(totalPending), hint: `${pendingSettlements.length} vendor settlement${pendingSettlements.length === 1 ? "" : "s"}`, icon: Wallet, tone: "text-blue-600", onClick: () => setActiveTab("pending"), active: activeTab === "pending" },
          { label: "Tax withheld (TDS/TCS)", value: inr(totalTaxWithheld), hint: "Deducted at source", icon: Download, tone: "text-amber-600" },
          { label: "Pending adjustments", value: inr(totalAdjustments), hint: "Not yet applied to a payout", icon: Settings2, tone: "text-rose-600" },
        ]}
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="pending">Pending ({pendingSettlements.length})</TabsTrigger>
          <TabsTrigger value="paid">Paid History</TabsTrigger>
        </TabsList>
        <TabsContent value="pending" className="pt-4">
          <DataTable columns={vCols} data={pendingSettlements} searchPlaceholder="Search vendors…" exportFilename="pending-vendor-settlements" />
        </TabsContent>
        <TabsContent value="paid" className="pt-4">
          <DataTable columns={vCols} data={paidSettlements} searchPlaceholder="Search vendors…" exportFilename="paid-vendor-settlements" />
        </TabsContent>
      </Tabs>

      <Dialog open={adjOpen} onOpenChange={setAdjOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Manual Adjustment</DialogTitle>
            <DialogDescription>
              Record a credit (bonus/refund reversal) or debit (penalty/dispute) for {adjRestName}. This will automatically apply to their next settlement cycle.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Adjustment Type</Label>
              <Select value={adjType} onValueChange={setAdjType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="debit">Debit (Deduction from Vendor)</SelectItem>
                  <SelectItem value="credit">Credit (Bonus for Vendor)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Amount (₹)</Label>
              <Input type="number" placeholder="500" value={adjAmount} onChange={(e) => setAdjAmount(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Reason / Note</Label>
              <Input placeholder="Customer refund recovery for Order #1234" value={adjReason} onChange={(e) => setAdjReason(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjOpen(false)}>Cancel</Button>
            <Button onClick={handleAddAdjustment} className={adjType === "debit" ? "bg-rose-600 hover:bg-rose-700" : "bg-emerald-600 hover:bg-emerald-700"}>
              {adjType === "debit" ? "Add Deduction" : "Add Credit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

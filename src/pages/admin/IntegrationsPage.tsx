import { useState } from 'react';
import { Blocks, CheckCircle2, Settings2, AlertTriangle, ExternalLink, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import { toast } from 'sonner';
import { Entity360Header } from '@/components/admin/entity360';
import { StatusBadge } from '@/components/admin/entity360';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface Integration {
  id: string;
  name: string;
  type: string;
  icon: string;
  purpose: string;
  configuredHint: string;
  configureLink?: string;
}

// Only the integrations Kada actually depends on. Health stays "Not checked"
// until an admin runs probeIntegrations — that probe confirms secrets, it does
// not invent an always-on status.
const integrations: Integration[] = [
  {
    id: 'firebase',
    name: 'Firebase',
    type: 'Backend, Auth, Firestore, FCM',
    icon: '🔥',
    purpose: 'Every app talks to Firestore + Firebase Auth. Cloud Functions live here. FCM handles push.',
    configuredHint: 'Configured via firebase.json / functions runtime env.',
  },
  {
    id: 'razorpay',
    name: 'Razorpay',
    type: 'Payment Gateway (money-in)',
    icon: '₹',
    purpose: 'Customer order payments, wallet top-ups, gold subscriptions.',
    configuredHint: 'Requires RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET function secrets.',
    configureLink: '/admin/reconciliation',
  },
  {
    id: 'razorpayx',
    name: 'RazorpayX',
    type: 'Payouts (money-out)',
    icon: '💸',
    purpose: 'Vendor settlements, rider withdrawals, host payouts.',
    configuredHint: 'Requires RAZORPAY_ACCOUNT_NUMBER secret to enable payouts. See Payout Runs banner.',
    configureLink: '/admin/payout-runs',
  },
  {
    id: 'google-maps',
    name: 'Google Maps',
    type: 'Location, geocoding, routing',
    icon: '📍',
    purpose: 'Customer address pins, rider live-tracking, delivery ETA (currently haversine).',
    configuredHint: 'GOOGLE_MAPS_API_KEY per app + billing enabled in GCP.',
  },
  {
    id: 'gemini',
    name: 'Gemini (Kada Assist)',
    type: 'AI (support + suggestions)',
    icon: '✨',
    purpose: 'Unified support chatbot + admin AI suggestions on the support console.',
    configuredHint: 'GEMINI_API_KEY function secret.',
    configureLink: '/admin/support',
  },
  {
    id: 'resend',
    name: 'Resend (Comms)',
    type: 'Transactional email',
    icon: '📧',
    purpose: 'Order/booking/support emails via the centralised comms platform.',
    configuredHint: 'thekada.in is verified. Secret version 2 is stored; running functions still use the previous secret until CPU quota allows a redeploy.',
    configureLink: '/admin/comms',
  },
];

const IntegrationsPage = () => {
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState<Record<string, { ok: boolean; detail: string }>>({});

  const runProbe = async () => {
    setBusy(true);
    try {
      const res = await httpsCallable(functions, "probeIntegrations")({});
      const probes = (res.data as { probes?: { id: string; ok: boolean; detail: string }[] }).probes ?? [];
      const next: Record<string, { ok: boolean; detail: string }> = {};
      for (const p of probes) next[p.id] = p;
      setHealth(next);
      const bad = probes.filter((p) => !p.ok);
      if (bad.length === 0) toast.success("Every integration responded.");
      else toast.error(`${bad.length} integration${bad.length === 1 ? "" : "s"} need attention.`);
    } catch (e: any) {
      toast.error(e?.message || "Health check failed.");
    } finally {
      setBusy(false);
    }
  };

  const probed = Object.keys(health).length > 0;
  const allOk = probed && Object.values(health).every((h) => h.ok);

  return (
    <div className="p-6 space-y-6">
      <Entity360Header
        title="System Integrations"
        subtitle="Developer & Infrastructure"
        status={
          <StatusBadge
            status={probed ? (allOk ? "active" : "warning") : "inactive"}
            label={probed ? (allOk ? "All responding" : "Needs attention") : "Not checked yet"}
          />
        }
        actions={
          <Button variant="outline" disabled={busy} onClick={runProbe}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Blocks className="mr-2 h-4 w-4" />}
            Health check
          </Button>
        }
      />

      {!probed && (
      <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:border-amber-500/30 dark:text-amber-300">
        <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" />
        <div>
          <p className="font-semibold">Run a health check to probe each integration.</p>
          <p className="text-amber-900/80 mt-0.5">
            The check confirms secrets are set and asks Razorpay whether the key is accepted. It does not show secret values.
          </p>
        </div>
      </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {integrations.map((integration) => (
          <Card key={integration.id}>
            <CardHeader className="flex flex-row items-center gap-4 pb-2">
              <div className="h-12 w-12 flex items-center justify-center rounded-xl bg-muted text-2xl">
                {integration.icon}
              </div>
              <div className="flex-1">
                <CardTitle className="text-lg">{integration.name}</CardTitle>
                <CardDescription>{integration.type}</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{integration.purpose}</p>
              <div className="flex items-center gap-2 mt-4">
                <CheckCircle2 className={`h-4 w-4 ${health[integration.id] ? (health[integration.id].ok ? "text-emerald-600" : "text-amber-600") : "text-muted-foreground"}`} />
                <span className="text-xs text-muted-foreground">{health[integration.id]?.detail ?? integration.configuredHint}</span>
              </div>
              {integration.configureLink && (
                <div className="mt-4 pt-4 border-t flex justify-end">
                  <Button variant="ghost" size="sm" asChild>
                    <Link to={integration.configureLink}>
                      <Settings2 className="mr-2 h-4 w-4" />
                      Manage
                      <ExternalLink className="ml-2 h-3 w-3" />
                    </Link>
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default IntegrationsPage;

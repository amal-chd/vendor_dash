import { Link } from "react-router-dom";
import { Scale, FlaskConical, History, ShieldAlert, ArrowRight } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Button } from "@/components/ui/button";

/**
 * This used to be a static preview of an unbuilt rules engine. Pricing, fee,
 * tax, surge, commission and promotion rules now live in the real engine
 * (functions/src/pricing), managed from the Pricing workspace.
 */
const BusinessRulesPage = () => (
  <div className="space-y-6">
    <AdminPageHeader
      title="Business rules"
      description="Where each kind of platform rule is managed."
      icon={Scale}
    />

    <div className="grid gap-4 md:grid-cols-3">
      {[
        { icon: Scale, title: "Pricing rules", body: "Delivery fees, surge (capped), platform and small-order fees, packaging, GST, commission, rider pay, promotions and Stay rates. Versioned, audited, role-gated.", to: "/admin/pricing" },
        { icon: FlaskConical, title: "Pricing simulator", body: "Price any cart or stay with the live engine and unpublished drafts before a change goes live.", to: "/admin/pricing?tab=simulator" },
        { icon: History, title: "Pricing audit log", body: "Every pricing change with who made it, why, and the exact before and after values.", to: "/admin/pricing?tab=audit" },
      ].map((c) => (
        <div key={c.title} className="flex flex-col rounded-lg border bg-card p-4">
          <c.icon className="mb-2 h-5 w-5 text-primary" />
          <h3 className="font-semibold">{c.title}</h3>
          <p className="mt-1 flex-1 text-sm text-muted-foreground">{c.body}</p>
          <Button asChild variant="outline" size="sm" className="mt-3 self-start">
            <Link to={c.to}>Open <ArrowRight className="ml-1 h-4 w-4" /></Link>
          </Button>
        </div>
      ))}
    </div>

    <div className="flex items-start gap-3 rounded-lg border p-4 text-sm">
      <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
      <div>
        <p className="font-semibold">Risk and quality rules</p>
        <p className="mt-1 text-muted-foreground">
          There is no configurable engine for these yet. Cash-on-delivery eligibility and order-value checks are enforced in the
          order functions, and vendor suspension is a manual action in Vendor 360. Nothing on this page is enforced by itself.
        </p>
      </div>
    </div>
  </div>
);

export default BusinessRulesPage;

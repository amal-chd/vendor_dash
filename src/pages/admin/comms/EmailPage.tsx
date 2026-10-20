import { Mail } from "lucide-react";
import { ChannelShell } from "./channelShell";
import CommsOverviewPage from "./CommsOverviewPage";
import EmailCampaignsPage from "./EmailCampaignsPage";
import AudiencesPage from "./AudiencesPage";
import EmailTemplatesPage from "./EmailTemplatesPage";
import EmailLogsPage from "./EmailLogsPage";
import CommsSettingsPage from "./CommsSettingsPage";
import EmailAutomationsPage from "./EmailAutomationsPage";
import EmailExperimentsPage from "./EmailExperimentsPage";

/**
 * EMAIL — one of the two (and only two) top-level communication channels.
 * The App selector + contextual tabs replace what used to be six separate
 * top-level pages. Every tab is backed by the real comms platform
 * (functions/src/comms) — no fabricated data.
 */
export default function EmailPage() {
  return (
    <ChannelShell
      embedded
      title="Email"
      subtitle="Transactional, lifecycle, operational & marketing email across all Kada apps."
      icon={<Mail className="h-5 w-5" />}
      tabs={[
        { key: "overview", label: "Overview", element: <CommsOverviewPage /> },
        { key: "campaigns", label: "Campaigns", element: <EmailCampaignsPage /> },
        { key: "create", label: "Create", element: <EmailCampaignsPage openCreate /> },
        { key: "audiences", label: "Audiences", element: <AudiencesPage /> },
        { key: "automations", label: "Automations", element: <EmailAutomationsPage /> },
        { key: "templates", label: "Templates", element: <EmailTemplatesPage /> },
        { key: "experiments", label: "Experiments", element: <EmailExperimentsPage /> },
        { key: "analytics", label: "Analytics", element: <EmailLogsPage /> },
        { key: "settings", label: "Settings", element: <CommsSettingsPage /> },
      ]}
    />
  );
}

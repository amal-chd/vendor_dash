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
import EmailJourneysPage from "./EmailJourneysPage";
import ContactsPage from "./ContactsPage";
import EmailInsightsPage from "./EmailInsightsPage";

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
      subtitle="Every email The Kada sends — receipts, partner updates, automations and campaigns — in one branded, consent-safe pipeline."
      icon={<Mail className="h-5 w-5" />}
      tabs={[
        { key: "overview", label: "Overview", element: <CommsOverviewPage /> },
        { key: "journeys", label: "Journeys", element: <EmailJourneysPage /> },
        { key: "campaigns", label: "Campaigns", element: <EmailCampaignsPage /> },
        { key: "templates", label: "Templates", element: <EmailTemplatesPage /> },
        { key: "audiences", label: "Audiences", element: <AudiencesPage /> },
        { key: "contacts", label: "Contacts", element: <ContactsPage /> },
        { key: "insights", label: "Insights", element: <EmailInsightsPage /> },
        { key: "experiments", label: "A/B tests", element: <EmailExperimentsPage /> },
        { key: "automations", label: "Simple triggers", element: <EmailAutomationsPage /> },
        { key: "activity", label: "Activity", element: <EmailLogsPage /> },
        { key: "settings", label: "Settings", element: <CommsSettingsPage /> },
      ]}
    />
  );
}

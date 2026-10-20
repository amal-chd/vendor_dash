import { useEffect, useMemo, useState } from "react";
import { runOp } from "@/lib/opFeedback";
import { collection, doc, onSnapshot, query, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { usePartnerContacts } from "@/hooks/usePartnerPrivate";
import { partnerDocKey, partnerEmail } from "@/lib/onboarding";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { DataTable } from "@/components/admin/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ColumnDef } from "@tanstack/react-table";
import { Users } from "lucide-react";
import { toast } from "sonner";

interface Host {
  id: string;
  name?: string;
  email?: string;
  status?: string;
  kycStatus?: string;
  city?: string;
}

export default function StayHosts() {
  const [hosts, setHosts] = useState<Host[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, "hotels"));
    return onSnapshot(
      q,
      (snap) => {
        setHosts(
          snap.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id,
              name: data.name || data.hostName || "Host",
              email: data.email || data.hostEmail || "",
              status: data.status || "active",
              kycStatus: data.kycStatus || "unsubmitted",
              city: data.city || data.location?.city || "",
            };
          }),
        );
        setLoading(false);
      },
      (err) => {
        console.error(err);
        toast.error("Failed to load hosts");
        setLoading(false);
      },
    );
  }, []);

  // Host email lives in partner_contact — hotels docs are public.
  const contacts = usePartnerContacts("host");
  const rows = useMemo(
    () => hosts.map((h) => ({ ...h, email: partnerEmail(contacts[partnerDocKey("host", h.id)], h) })),
    [hosts, contacts],
  );

  const columns: ColumnDef<Host>[] = [
    { accessorKey: "name", header: "Host / property" },
    { accessorKey: "email", header: "Email" },
    { accessorKey: "city", header: "City" },
    { accessorKey: "kycStatus", header: "KYC", cell: ({ row }) => <Badge variant="outline">{row.original.kycStatus}</Badge> },
    { accessorKey: "status", header: "Status" },
    {
      id: "a",
      cell: ({ row }) => (
        <div className="flex gap-1 justify-end">
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              runOp(
                () =>
                  updateDoc(doc(db, "hotels", row.original.id), {
                    kycStatus: "approved",
                    status: "Approved",
                  }),
                "Host KYC approved",
                { failure: "Couldn't approve this host" },
              )
            }
          >
            Approve KYC
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              runOp(
                () => updateDoc(doc(db, "hotels", row.original.id), { status: "suspended" }),
                "Host suspended",
                { failure: "Couldn't suspend this host" },
              )
            }
          >
            Suspend
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Stay hosts"
        description="Every host account and the property it runs."
        icon={Users}
      />
      <DataTable columns={columns} data={rows} searchPlaceholder="Search hosts…" exportFilename="stay-hosts" />
    </div>
  );
}

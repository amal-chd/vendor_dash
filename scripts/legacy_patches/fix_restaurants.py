import re

with open("src/pages/admin/RestaurantsPage.tsx", "r") as f:
    content = f.read()

# 1. Imports
content = content.replace('import { VendorBrandLockup } from "@/components/admin/vendor/VendorBrandLockup";', 
                          'import { AdminPageHeader } from "@/components/admin/AdminPageHeader";\nimport { StatCards } from "@/components/admin/StatCards";\nimport { EntityDrawer } from "@/components/admin/core/EntityDrawer";\nimport { ConfirmationDialog } from "@/components/admin/core/ConfirmationDialog";\nimport { VendorBrandLockup } from "@/components/admin/vendor/VendorBrandLockup";')

# 2. Add state for ConfirmationDialog
state_match = re.search(r'const \[deleteConfirmText, setDeleteConfirmText\] = useState\(""\);', content)
if state_match:
    content = content[:state_match.end()] + '\n  const [bulkConfirm, setBulkConfirm] = useState<{ action: "suspend" | "activate"; rows: Restaurant[] } | null>(null);' + content[state_match.end():]

# 3. Replace the Page Header and add StatCards
header_regex = re.compile(r'<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">.*?</div>\s*</div>', re.DOTALL)
new_header = """<AdminPageHeader
        title="Vendors & Restaurants"
        description="Manage restaurant partners, subscription plans, and platform-wide commissions."
        icon={Building2}
        stats={[
          { label: "Total Venues", value: String(counts.total) },
          { label: "Active", value: String(counts.active) },
          { label: "On Trial", value: String(counts.trial) },
        ]}
        actions={
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Input
              placeholder="Search name or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 w-full sm:w-56 text-sm"
            />
            <Button 
              className="h-9 gap-1.5 shrink-0" 
              onClick={() => {
                setSelected(null);
                setDraft({});
                setSheetOpen(true);
              }}
            >
              <Building2 className="w-4 h-4" />
              <span className="hidden sm:inline">Add Vendor</span>
              <span className="sm:hidden">Add</span>
            </Button>
          </div>
        }
      />
      
      <StatCards 
        items={[
          { label: "Active Partners", value: String(counts.active), icon: CheckCircle2, tone: "text-emerald-500" },
          { label: "On Trial", value: String(counts.trial), icon: Clock, tone: "text-amber-500" },
          { label: "Blocked/Suspended", value: String(counts.blocked), icon: Ban, tone: "text-rose-500" },
          { label: "Pending KYC", value: String(counts.pending), icon: ShieldAlert, tone: "text-blue-500" },
        ]} 
      />"""
content = header_regex.sub(new_header, content, count=1)

# 4. Replace bulkActions confirm with state
content = content.replace('''if (confirm(`Suspend ${rows.length} restaurants?`)) {
                Promise.all(rows.map(r => updateDoc(doc(db, "restaurants", r.id), { isBlocked: true })))
                  .then(() => toast.success(`Suspended ${rows.length} restaurants`))
                  .catch(() => toast.error("Failed to suspend some restaurants"));
              }''', '''setBulkConfirm({ action: "suspend", rows });''')

content = content.replace('''if (confirm(`Activate ${rows.length} restaurants?`)) {
                Promise.all(rows.map(r => updateDoc(doc(db, "restaurants", r.id), { isBlocked: false })))
                  .then(() => toast.success(`Activated ${rows.length} restaurants`))
                  .catch(() => toast.error("Failed to activate some restaurants"));
              }''', '''setBulkConfirm({ action: "activate", rows });''')

# 5. Add ConfirmationDialog at the end of the file
dialog_ui = '''
      <ConfirmationDialog
        open={!!bulkConfirm}
        onOpenChange={(v) => !v && setBulkConfirm(null)}
        title={bulkConfirm?.action === "suspend" ? `Suspend ${bulkConfirm.rows.length} vendors?` : `Activate ${bulkConfirm.rows.length} vendors?`}
        description={bulkConfirm?.action === "suspend" ? "This will immediately hide these vendors from the customer apps and stop incoming orders." : "This will immediately restore these vendors to the platform and allow them to receive orders."}
        confirmLabel={bulkConfirm?.action === "suspend" ? "Suspend Vendors" : "Activate Vendors"}
        variant={bulkConfirm?.action === "suspend" ? "destructive" : "default"}
        requireReason={true}
        onConfirm={async (reason) => {
          if (!bulkConfirm) return;
          try {
            await Promise.all(
              bulkConfirm.rows.map(r => updateDoc(doc(db, "restaurants", r.id), { isBlocked: bulkConfirm.action === "suspend" }))
            );
            toast.success(`${bulkConfirm.action === "suspend" ? "Suspended" : "Activated"} ${bulkConfirm.rows.length} vendors`);
            setBulkConfirm(null);
          } catch (err) {
            toast.error("Failed to update vendors");
          }
        }}
      />
'''
content = content.replace('</AlertDialog>', '</AlertDialog>\n' + dialog_ui)

with open("src/pages/admin/RestaurantsPage.tsx", "w") as f:
    f.write(content)

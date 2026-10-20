const admin = require('firebase-admin');
admin.initializeApp({
  projectId: "kadadevelop",
});
const db = admin.firestore();

const ROLE_PERMISSIONS = {
  super_admin: ["view", "create", "edit", "delete", "approve", "refund", "suspend", "export", "view_financial", "view_pii", "manage_admins"],
  platform_admin: ["view", "create", "edit", "delete", "approve", "suspend", "export", "view_financial", "view_pii"],
  ops_manager: ["view", "create", "edit", "suspend", "export", "view_pii"],
  finance_manager: ["view", "approve", "refund", "export", "view_financial"],
  support_manager: ["view", "create", "edit", "approve", "refund", "export", "view_pii"],
  support_agent: ["view", "create", "edit", "view_pii"],
  vendor_manager: ["view", "create", "edit", "suspend", "approve", "export", "view_pii"],
  delivery_manager: ["view", "create", "edit", "suspend", "export", "view_pii"],
  stay_manager: ["view", "create", "edit", "suspend", "approve", "export", "view_pii"],
  marketing_manager: ["view", "create", "edit", "export"],
  analytics: ["view", "export", "view_financial"],
  developer: ["view", "create", "edit", "export"],
  auditor: ["view", "export", "view_financial"],
};

const WORKSPACE_ACCESS = {
  super_admin: ["dashboard", "orders", "customers", "vendors", "delivery", "markets", "finance", "stay", "support", "quality", "growth", "analytics", "settings"],
  platform_admin: ["dashboard", "orders", "customers", "vendors", "delivery", "markets", "finance", "stay", "support", "quality", "growth", "analytics", "settings"],
  ops_manager: ["dashboard", "orders", "customers", "vendors", "delivery", "markets", "stay", "support", "quality", "analytics"],
  finance_manager: ["dashboard", "vendors", "finance", "analytics", "settings"],
  support_manager: ["dashboard", "orders", "customers", "vendors", "support", "quality", "analytics"],
  support_agent: ["dashboard", "orders", "customers", "support"],
  vendor_manager: ["dashboard", "vendors", "quality", "growth", "analytics"],
  delivery_manager: ["dashboard", "orders", "delivery", "markets", "quality", "analytics"],
  stay_manager: ["dashboard", "stay", "markets", "quality", "analytics"],
  marketing_manager: ["dashboard", "customers", "growth", "analytics"],
  analytics: ["dashboard", "analytics"],
  developer: ["dashboard", "settings"],
  auditor: ["dashboard", "finance", "quality", "analytics", "settings"],
};

db.collection('config').doc('admin_rbac').set({
  rolePermissions: ROLE_PERMISSIONS,
  workspaceAccess: WORKSPACE_ACCESS,
  updatedAt: admin.firestore.FieldValue.serverTimestamp()
}).then(() => {
  console.log("Seeded config/admin_rbac");
  process.exit(0);
});

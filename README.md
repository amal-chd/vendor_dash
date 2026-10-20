# Kada Dine - Product Specification & Documentation

**Kada Dine** is a comprehensive, multi-tenant Software-as-a-Service (SaaS) platform designed to orchestrate and streamline the end-to-end operations of modern restaurants. It caters to three primary roles:
1. **Diners / Customers:** Users viewing digital menus and placing contactless orders via QR codes.
2. **Vendors / Restaurant Staff:** Owners, managers, and staff interacting with POS, kitchen display, inventory, and analytics.
3. **Platform Admins:** Super-administrators managing billing plans, feature flags, restaurants, and demo requests.

---

## 1. Technology Stack
- **Frontend Framework:** React 18 with TypeScript.
- **Build Tool:** Vite.
- **Styling:** Tailwind CSS with `shadcn/ui` (Radix UI) and `framer-motion` for micro-animations. Supports Light/Dark mode via `next-themes`.
- **State Management & Data Fetching:** `@tanstack/react-query` and React Context.
- **Forms & Validation:** `react-hook-form` paired with `zod`.
- **Database & Authentication (Primary):** Firebase (Firestore, Firebase Auth, Cloud Storage).
- **Secondary Database:** Supabase (utilized exclusively as a read-only data source for external franchise syncing).
- **Payments:** Razorpay (server-created orders, signature-checked confirmation).
- **Charts / Analytics:** `recharts`.
- **Vendor Mobile Environment:** Flutter app available in `vendor_mobile_app/` and PWA Web shell available at `/vendor-mobile` for cross-platform utility.

---

## 2. Repositories / Apps Included
- **Web App:** Vite + React + TypeScript (Root level directory)
- **Vendor Mobile App:** Flutter (`vendor_mobile_app/`)



---

## 5. Data Architecture (Firestore Schema)
The system is built horizontally using a multi-tenant schema where the `restaurantId` enforces isolated data access.

### Core Collections
- **`restaurants`**: The absolute core entity. Contains restaurant configurations, operating hours, and plan info.
  - **`customers`** (Subcollection): Diners scoped strictly per restaurant, capturing metrics like `lastOrderDate`, `totalOrders`, and `totalSpent`.
  - **`notifications`** (Subcollection): Activity feeds and alerts for the restaurant.
- **`menu`**: Contains dishes, categories, dietary properties, and pricing.
- **`orders`**: Real-time sales data. Supports authenticated staff creation and unauthenticated public customer creation (Dine-in via QR).
- **`tables`**: Maps QR codes and spatial layout of the restaurant.
- **`kitchen`**: View models mapped directly to the `orders` collection based on live status.
- **`inventory` / `inventory_logs`**: Tracks raw ingredient stockpiles and deduction audits.
- **`staff`**: Role-based access control (RBAC) extending specific permissions (e.g., manager, chef, waiter) to employees.
- **`campaigns` / `menu_ads`**: Marketing and promotional flags integrated into the public-facing QR menu.

### Admin/Platform Collections
- **`config`**: Granular global feature flags.
- **`demo_requests` & `contact_requests`**: Lead-generation pipelines mapped globally to the platform admins.
- **`support_tickets`**: Intercom-style ticket logs between vendors and platform admins.
- **`admin_logs`**: Secure mutation tracking for platform actions.

---

## 6. Platform Flow & User Journeys

### 6.1. The Diner Flow (QR Menu)
1. Diner scans a dynamically generated QR Code bound to a specific `tableId` & `restaurantId`.
2. Directed to the **Public Menu Page** (`/menu`).
3. Diner views localized menu, filters by preferences (e.g., dietary tags), and views dynamically injected `menu_ads`.
4. Diner constructs an order. 
5. The unauthenticated client writes a "new" order payload directly to `/orders` (enforced by strict Firestore security rules requiring `type: "dine-in"`).
6. Webhook triggers or realtime listeners push the order instantly to the POS and Kitchen screens.

### 6.2. The Vendor / Staff Workflow (App Core)
1. Staff member accesses the Web Dashboard or Vendor Mobile Companion.
2. Authenticates via Firebase Auth.
3. Accesses module based on active routing (`/dashboard/*`):
   - **POS (`/pos`)**: Fast-action interface to ring up walk-in customers and print professional invoices.
   - **Kitchen (`/kitchen`)**: Real-time Ticket routing. Chefs bump tickets from "Received" -> "Preparing" -> "Ready".
   - **Orders (`/orders`)**: Ledger of historical data and active fulfillment tracking.
   - **Menu Studio (`/menu`)**: CRUD operations for dishes, variants, and modifiers.
   - **Inventory (`/inventory`)**: Stock management and margin analysis.
   - **Customers (`/customers`)**: Localized CRM showing frequent flyer diners and lifetime values.
   - **Reports (`/reports`)**: Actionable aggregations using `recharts` for charting sales velocities over time.

### 6.3. The Admin Configuration Flow
1. Super-Admin (e.g., `thekada@gmail.com`) logs into `/admin`.
2. Bypasses standard dashboard routes directly into the Platform Dashboard.
3. Overviews restaurants, plans, and subscription status.
4. Inspects **Demo Requests** to contact incoming B2B leads.
5. Manages multi-tenant instances via **Restaurants** and **Plans**.

---

## 7. Security Policies
1. **Public Attack Vectors:** Strict schema validation within Firebase Security Rules prevents tampering with `orders`, `demo_requests`, and `contact_requests` payloads. Ensures strings meet max length caps and specific states are hardcoded (e.g., `status == "new"`).
2. **Tenant Isolation:** Read/Write operations recursively evaluate `resource.data.restaurantId == request.auth.uid` guaranteeing absolute isolation between distinct restaurant accounts.
3. **Admin Escalation:** The `isAdmin()` custom rule scopes globally readable metric components to verified host emails.

## 8. Deployment
This repo supports standard static hosting for the web build output (`dist/`) and standard Flutter release builds for the mobile app natively.

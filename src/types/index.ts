// Standardized Enterprise Type Definitions for Kada Dine
// Includes Indian statutory GST (CGST/SGST/IGST), FSSAI compliance, and UPI billing fields.

export interface Restaurant {
  id: string;
  name: string;
  slug?: string;
  ownerUid?: string;
  contactPhone?: string;
  supportEmail?: string;
  timezone?: string;
  currency?: string;
  isActive?: boolean;
  onboardingStep?: string;
  parentId?: string; // For outlets
  isOutlet?: boolean;
  address?: string;
  city?: string;
  state?: string;
  postalCode?: string;

  // Indian Statutory Compliance
  gstin?: string; // 15-character statutory format
  fssaiLicense?: string; // 14-digit FSSAI license number
  isGstRegistered?: boolean;
  defaultGstRate?: "0" | "5" | "12" | "18";
  taxInclusivePricing?: boolean;

  // Subscription & Capabilities
  subscriptionStatus?: string;
  subscriptionType?: string;
  capabilities?: string[];
  [key: string]: any;
}

export interface OrderItem {
  id?: string;
  menuItemId?: string;
  name: string;
  quantity: number;
  price: number;
  unitPrice?: number;
  taxRate?: number;
  hsnCode?: string; // Statutory HSN/SAC food classification code
  instructions?: string;
  selectedVariants?: { name: string; price: number }[];
  [key: string]: any;
}

export interface Order {
  id?: string;
  orderNumber?: string;
  restaurantId?: string;
  customerName?: string;
  customerPhone?: string;
  table?: string;
  type?: "dine_in" | "takeaway" | "delivery" | "qr_order" | string;
  status?: "new" | "preparing" | "ready" | "out_for_delivery" | "completed" | "cancelled" | string;
  items: OrderItem[];
  total: number;
  subtotal?: number;
  discountAmount?: number;
  deliveryFee?: number;
  packagingCharge?: number;

  // Indian Statutory Tax Breakdown
  cgst?: number; // Central GST amount (2.5% for standard dining)
  sgst?: number; // State GST amount (2.5% for standard dining)
  igst?: number; // Integrated GST amount for interstate

  paymentStatus?: "pending" | "paid" | "refunded" | "failed" | string;
  paymentMethod?: "cash" | "upi_qr" | "card" | "razorpay" | "split" | string;
  instructions?: string;
  timestamp?: any;
  createdAt?: any;
  [key: string]: any;
}

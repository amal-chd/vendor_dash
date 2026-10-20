/**
 * Shared admin domain types for the Control Center (Live Operations, Risk, …).
 * Kept permissive (optional fields + index signature) because the underlying
 * Firestore documents are loosely typed and evolve independently.
 */

export interface LiveOrder {
  id: string;
  orderNumber?: string;
  status?: string;
  deliveryStatus?: string;
  restaurantId?: string;
  restaurantName?: string;
  riderId?: string;
  riderName?: string;
  customerName?: string;
  customerPhone?: string;
  orderSource?: string;
  customerUid?: string;
  userId?: string;
  customerId?: string;
  isExpedited?: boolean;
  total?: number;
  riskScore?: number;
  signals?: string[];
  createdAt?: unknown;
  timestamp?: unknown;
  [key: string]: any;
}

export interface RiderInfo {
  id: string;
  name?: string;
  riderName?: string;
  phone?: string;
  riderPhone?: string;
  isOnline?: boolean;
  status?: string;
  currentOrderId?: string;
  restaurantName?: string;
  customerName?: string;
  deliveryAddressText?: string;
  items?: any[];
  lat?: number;
  lng?: number;
  [key: string]: any;
}

export interface RestaurantInfo {
  id: string;
  name?: string;
  restaurantName?: string;
  status?: string;
  isOnline?: boolean;
  lat?: number;
  lng?: number;
  [key: string]: any;
}

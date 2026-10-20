// Starter Knowledge Base for Kada Assist. Seeded (with embeddings) by the
// `seedKnowledgeBase` callable. `role`: 'all' | 'customer' | 'vendor' | 'rider' | 'host'.
// `seedKey` keeps the seeder idempotent so re-running never duplicates.

export interface SeedArticle {
  seedKey: string;
  role: "all" | "customer" | "vendor" | "rider" | "host";
  category: string;
  title: string;
  content: string;
  tags: string[];
}

export const SEED_ARTICLES: SeedArticle[] = [
  // ── Shared / all apps ──────────────────────────────────────────────────────
  {
    seedKey: "all-about-kada",
    role: "all",
    category: "General",
    title: "About Kada",
    content:
      "Kada is a food-ordering and delivery platform connecting customers, restaurants and delivery partners. Customers order from nearby restaurants on the Kada app, restaurants manage orders on the Kada vendor app, and delivery partners fulfil them on the Kada rider app. For anything Kada Assist cannot resolve, you can ask to chat with a human agent.",
    tags: ["about", "kada", "help", "support"],
  },
  {
    seedKey: "all-contact-human",
    role: "all",
    category: "General",
    title: "Talk to a human agent",
    content:
      "If the assistant cannot help, tap 'Talk to a human' in the chat. Your conversation is handed to a Kada support agent who can see your history and will reply in the same chat, usually within a few minutes during operating hours. You do not need to repeat yourself — the agent has the full context.",
    tags: ["human", "agent", "escalate", "contact", "support"],
  },
  {
    seedKey: "all-app-not-working",
    role: "all",
    category: "Troubleshooting",
    title: "App is slow, crashing or not loading",
    content:
      "First, check your internet connection and try again. Then force-close and reopen the app. If it still fails, make sure you are on the latest version from the App Store or Play Store, and restart your phone. Clearing the app cache (Android) often helps. If the problem continues, ask to chat with a human and mention your phone model.",
    tags: ["crash", "slow", "loading", "bug", "troubleshoot"],
  },
  {
    seedKey: "all-login-issue",
    role: "all",
    category: "Account",
    title: "Login and OTP problems",
    content:
      "Kada uses phone-number OTP as the primary login, with Google and Apple as alternatives. If the OTP does not arrive, wait 30 seconds and tap Resend, check that the number is correct with the right country code, and ensure you have signal. OTP SMS can be delayed on some networks. If you signed up with Google or Apple, use the same method next time. Persistent issues: talk to a human.",
    tags: ["login", "otp", "sign in", "account", "phone"],
  },

  // ── Customer app ───────────────────────────────────────────────────────────
  {
    seedKey: "cust-where-is-order",
    role: "customer",
    category: "Orders",
    title: "Where is my order? Tracking your delivery",
    content:
      "Open the app and go to Orders (or tap the live tracking banner on the home screen) to see your order's live status: order confirmed, restaurant preparing, ready, picked up by the rider, on the way, and delivered. Once a rider is assigned you can watch them approach on the live map and see the estimated arrival time. On iPhone the status also appears as a Live Activity on your lock screen and Dynamic Island. If the timer has stalled or the order seems stuck, ask to chat with a human with your order number ready.",
    tags: ["track", "where", "order", "status", "delivery", "eta"],
  },
  {
    seedKey: "cust-cancel-order",
    role: "customer",
    category: "Orders",
    title: "Cancel an order",
    content:
      "You can cancel free of charge before the restaurant accepts and starts preparing your order — open the order and tap Cancel. Once the kitchen has started cooking, a cancellation charge may apply because the food is already being prepared, and once the rider has picked it up the order usually cannot be cancelled. If you need to cancel a prepared order due to a genuine problem, ask to chat with a human.",
    tags: ["cancel", "order", "refund", "charge"],
  },
  {
    seedKey: "cust-refund",
    role: "customer",
    category: "Payments",
    title: "Refunds — how and when",
    content:
      "If an order is cancelled before acceptance, or a valid issue is confirmed, the amount is refunded to your original payment method within 5–7 business days. Payments made from your Kada wallet are refunded to the wallet instantly. Refund eligibility for missing items, spillage or quality issues is reviewed case by case — report it from the order within 48 hours. You can check refund status in the order details or by asking the assistant.",
    tags: ["refund", "money back", "wallet", "payment", "timeline"],
  },
  {
    seedKey: "cust-missing-items",
    role: "customer",
    category: "Orders",
    title: "Missing, wrong or spilled items",
    content:
      "If part of your order is missing, incorrect, or arrived spilled or damaged, open the order, tap Report an issue, and describe what went wrong (a photo helps). Genuine issues are resolved with a refund or credit to your Kada wallet. Please report within 48 hours of delivery. For urgent help while the rider is still there, ask to chat with a human.",
    tags: ["missing", "wrong", "spilled", "damaged", "quality", "issue"],
  },
  {
    seedKey: "cust-delivery-fee",
    role: "customer",
    category: "Payments",
    title: "Delivery fees and free delivery",
    content:
      "The delivery fee depends on the distance from the restaurant to your address and is shown before you pay. Some restaurants offer free delivery, and orders may qualify for free-delivery promotions. Kada Gold members get free delivery on eligible orders. A small surge fee can apply during peak hours or bad weather; it is always shown in the bill before you place the order.",
    tags: ["delivery fee", "free delivery", "charges", "surge", "bill"],
  },
  {
    seedKey: "cust-gold",
    role: "customer",
    category: "Kada Gold",
    title: "Kada Gold membership and benefits",
    content:
      "Kada Gold is a paid membership that gives free delivery on eligible orders, an exclusive member discount on the food subtotal (up to 30% at partner restaurants, otherwise 10%), and priority support. You can join from the Kada Gold screen in your profile and pay from your Kada wallet — ₹99 for one month. Buying again while active extends your membership. Your Gold status and expiry date are shown in your profile.",
    tags: ["gold", "membership", "vip", "discount", "free delivery", "subscribe"],
  },
  {
    seedKey: "cust-wallet",
    role: "customer",
    category: "Payments",
    title: "Kada wallet and payment methods",
    content:
      "You can pay by UPI, card, or Cash on Delivery, or from your Kada wallet. The wallet holds refunds, gift-card credit and top-ups, and can be used to pay for orders or a Kada Gold membership. Add money from the wallet section in your profile. If a wallet payment failed but money was deducted, it is auto-reversed; if you do not see it within a few hours, ask to chat with a human.",
    tags: ["wallet", "payment", "upi", "card", "cod", "balance", "top up"],
  },
  {
    seedKey: "cust-address",
    role: "customer",
    category: "Account",
    title: "Managing delivery addresses",
    content:
      "Add or edit delivery addresses in your profile or during checkout. You can pin a location on the map for accuracy and label addresses as Home, Work, etc. At checkout your last-used address is selected automatically; tap Change to pick another or drop a new pin. Accurate addresses and a landmark help the rider reach you faster.",
    tags: ["address", "location", "map", "home", "delivery"],
  },
  {
    seedKey: "cust-order-for-other",
    role: "customer",
    category: "Orders",
    title: "Ordering for someone else",
    content:
      "At checkout you can choose to order for someone else and enter the recipient's name and phone number, so the rider contacts and delivers to them instead of you. The delivery address should be the recipient's location. This is useful for gifting a meal or ordering to another home.",
    tags: ["gift", "someone else", "recipient", "order for other"],
  },
  {
    seedKey: "cust-offers",
    role: "customer",
    category: "Offers",
    title: "Offers, coupons and promo codes",
    content:
      "Find available coupons in the Offers section or on the home screen. Copy a code and apply it in your cart before checkout to see the discount. Each coupon has conditions such as a minimum order value or a maximum discount. Coupon and Gold discounts can stack with free delivery. If a valid code will not apply, check the minimum order value first, then ask the assistant.",
    tags: ["offers", "coupon", "promo", "discount", "code"],
  },
  {
    seedKey: "cust-rate-order",
    role: "customer",
    category: "Orders",
    title: "Rating your order and rider",
    content:
      "After delivery you can rate the food and the delivery separately and leave a tip for your rider. Ratings help restaurants and riders improve and appear on their profiles. You can rate from the delivered order in your Orders list.",
    tags: ["rate", "review", "tip", "feedback", "rider"],
  },

  // ── Rider app ──────────────────────────────────────────────────────────────
  {
    seedKey: "rider-earnings",
    role: "rider",
    category: "Earnings",
    title: "How rider earnings are calculated",
    content:
      "Your payout for each delivery is a base fee of ₹20 plus ₹8 per kilometre (measured from the restaurant to the drop address) plus 100% of any tip the customer adds. Earnings are added to your Today, This Week and Lifetime totals on the Earnings screen the moment you complete a delivery. Log your fuel and expenses to see your true net in-pocket for the day.",
    tags: ["earnings", "payout", "base", "per km", "tips", "income"],
  },
  {
    seedKey: "rider-payout",
    role: "rider",
    category: "Earnings",
    title: "Withdrawing your earnings (payout)",
    content:
      "Your available balance is your lifetime earnings minus what has already been paid out. On the Earnings screen tap Request Payout, enter your UPI ID, and submit — the minimum payout is ₹100. Kada operations settle payout requests to your UPI, usually within 24 hours. You can only have one payout request pending at a time. This is separate from COD cash settlement.",
    tags: ["payout", "withdraw", "upi", "earnings", "settlement", "money"],
  },
  {
    seedKey: "rider-cod",
    role: "rider",
    category: "Earnings",
    title: "COD cash and settlement",
    content:
      "Cash you collect from Cash-on-Delivery orders appears in your Cash-in-Hand block. This is money you owe Kada; settle it with the Kada operations hub via UPI or a cash deposit, daily or weekly. It is tracked separately from your online earnings payout. Keep your cash settled so your account stays in good standing.",
    tags: ["cod", "cash", "settle", "deposit", "collection"],
  },
  {
    seedKey: "rider-order-not-showing",
    role: "rider",
    category: "Orders",
    title: "Order offers not showing up",
    content:
      "You only receive delivery offers when you are Online and have granted location permission, and when there is an order near you awaiting a rider. Make sure you are toggled Online, location is set to Always/While-Using, and you have a stable connection. If you accepted an order but it disappeared, it may have been reassigned after the accept window expired. Persisting issues: talk to a human.",
    tags: ["no orders", "not showing", "offline", "online", "offers"],
  },
  {
    seedKey: "rider-customer-unreachable",
    role: "rider",
    category: "Delivery",
    title: "Customer not responding at delivery",
    content:
      "If the customer is not answering, call them from the order using the in-app call, and send a chat message. Wait at the delivery location for the standard waiting time. If you still cannot reach them, use the app's flow to report an unreachable customer or ask to chat with a human — do not leave the order unattended without following the process.",
    tags: ["customer", "unreachable", "not answering", "call", "wait"],
  },
  {
    seedKey: "rider-navigation",
    role: "rider",
    category: "Delivery",
    title: "Navigation and GPS issues",
    content:
      "The app uses your phone's GPS to match you to nearby orders and to guide you. If navigation is off, enable high-accuracy/precise location, grant the app location access (Always or While-Using), and make sure GPS is on. Restart the app if your position looks wrong. A stable data connection keeps the live map accurate for the customer.",
    tags: ["gps", "navigation", "location", "map", "accuracy"],
  },
  {
    seedKey: "rider-online-offline",
    role: "rider",
    category: "Getting started",
    title: "Going online and getting approved",
    content:
      "New riders must be approved by Kada before receiving orders — upload the required documents in your profile and wait for verification. Once approved, toggle yourself Online to start receiving delivery offers, and Offline when you finish. You must be Online, approved and near demand to get offers.",
    tags: ["online", "offline", "approval", "documents", "verification", "start"],
  },

  // ── Vendor app ─────────────────────────────────────────────────────────────
  {
    seedKey: "vendor-new-orders",
    role: "vendor",
    category: "Orders",
    title: "New orders not showing up",
    content:
      "Incoming Kada orders appear on your Orders and Kitchen screens and trigger a notification. If you are not seeing them, check your internet connection, make sure notifications are enabled for the Kada vendor app, and confirm your restaurant is marked Open with the current hours set. Keep the app open or in the background during service. If orders still do not arrive, talk to a human.",
    tags: ["new order", "not showing", "notification", "orders", "open"],
  },
  {
    seedKey: "vendor-accept-prepare",
    role: "vendor",
    category: "Orders",
    title: "Accepting and preparing orders",
    content:
      "When an order arrives, accept it to confirm to the customer and the assignment engine that you are preparing it, then advance the status as you cook: preparing, ready. A rider is assigned automatically and heads to your restaurant while the food is prepared, so mark items ready promptly to keep delivery times short.",
    tags: ["accept", "prepare", "ready", "kitchen", "status"],
  },
  {
    seedKey: "vendor-cancel-order",
    role: "vendor",
    category: "Orders",
    title: "Cancelling or rejecting an order",
    content:
      "If you genuinely cannot fulfil an order (an item is out of stock or the kitchen is overloaded), cancel or reject it as early as possible so the customer is refunded and not left waiting. Frequent cancellations affect your restaurant's reliability rating. For disputes about a cancelled order, talk to a human.",
    tags: ["cancel", "reject", "out of stock", "order"],
  },
  {
    seedKey: "vendor-menu-hours",
    role: "vendor",
    category: "Catalog",
    title: "Editing menu, prices and opening hours",
    content:
      "Manage your items, prices, categories and photos from the Menu screen, and set your opening hours and Open/Closed status in Settings. Mark items unavailable when you run out so customers do not order them. Keeping the menu and hours accurate reduces cancellations and improves your ratings.",
    tags: ["menu", "price", "hours", "open", "closed", "items", "availability"],
  },
  {
    seedKey: "vendor-payouts",
    role: "vendor",
    category: "Payments",
    title: "Restaurant payouts and settlement",
    content:
      "Revenue from your Kada orders (minus applicable commission and fees) is settled to your registered bank account on the platform's payout cycle. You can track your Kada order revenue and trends on the Kada Analytics screen. For questions about a specific settlement amount or a missing payout, talk to a human with the date range.",
    tags: ["payout", "settlement", "revenue", "bank", "commission"],
  },
  {
    seedKey: "vendor-analytics",
    role: "vendor",
    category: "Insights",
    title: "The Kada Analytics — tracking your app orders",
    content:
      "The Kada Analytics screen shows the business coming specifically from the Kada consumer app: revenue, order count, average bill, share of your total orders, repeat-customer rate, payment mix, top items and a live order-status strip, over Today / 7 days / 30 days. Use it to see how your Kada delivery channel is performing.",
    tags: ["analytics", "reports", "revenue", "orders", "insights", "kada"],
  },
  {
    seedKey: "vendor-subscription",
    role: "vendor",
    category: "Account",
    title: "Subscription plans and billing",
    content:
      "Your Kada vendor subscription unlocks the app's features by plan tier. You can view your plan and renewal date in Settings \u2192 Billing in the app. Subscriptions are purchased and renewed on the Kada web dashboard, billed securely through Razorpay \u2014 the mobile app does not take payments. There is no free trial. If your subscription has expired, renew it on the dashboard to keep receiving orders; the app unlocks automatically within seconds. For billing questions, talk to a human.",
    tags: ["subscription", "plan", "billing", "renew", "upgrade", "razorpay"],
  },
  {
    seedKey: "vendor-staff",
    role: "vendor",
    category: "Account",
    title: "Staff logins and roles",
    content:
      "You can add staff members with their own roles and permissions so they only see the features they need. Staff can sign in on a shared device with a PIN, or with their own email login if you enable it for them. Manage staff, roles and access from the Team section.",
    tags: ["staff", "roles", "permissions", "team", "login", "pin"],
  },

  // ── Customer — additional real-world scenarios ─────────────────────────────
  {
    seedKey: "cust-order-delayed",
    role: "customer",
    category: "Orders",
    title: "My order is taking too long / is delayed",
    content:
      "Delays can happen during peak hours, bad weather, or if the restaurant is busy. Check the live status and ETA on the order screen — the estimated time updates as the order progresses. If the timer has clearly stalled, the rider is not moving, or the order is well past the ETA, tap Report an issue or ask to chat with a human with your order number so we can check with the restaurant and rider.",
    tags: ["delay", "late", "taking long", "slow", "eta", "stuck"],
  },
  {
    seedKey: "cust-rider-cant-find",
    role: "customer",
    category: "Delivery",
    title: "The rider cannot find my location",
    content:
      "If the rider is nearby but cannot find you, answer their call and share a landmark, or edit the delivery instructions on the order. Make sure your pinned map location and flat/building number are correct. You can also drop an updated pin from the order if the rider has not yet arrived. Keeping your phone reachable during delivery avoids failed deliveries.",
    tags: ["rider", "find", "location", "landmark", "pin", "reach"],
  },
  {
    seedKey: "cust-wrong-order",
    role: "customer",
    category: "Orders",
    title: "I received the wrong order",
    content:
      "If you were handed someone else's order or the items are not what you ordered, do not discard anything — open the order, tap Report an issue, and describe what you received (a photo helps). Confirmed wrong-order cases are resolved with a refund or a re-delivery of the correct items. Report it as soon as possible, ideally while the rider is still with you.",
    tags: ["wrong order", "not my order", "incorrect", "mix up"],
  },
  {
    seedKey: "cust-cold-food",
    role: "customer",
    category: "Quality",
    title: "Food arrived cold or poor quality",
    content:
      "We are sorry the food was not up to standard. Report it from the order within 48 hours with a short description and a photo. Quality complaints are shared with the restaurant and, when valid, resolved with a refund or wallet credit. Consistent quality issues from a restaurant affect its rating and standing on Kada.",
    tags: ["cold", "quality", "stale", "bad food", "taste", "complaint"],
  },
  {
    seedKey: "cust-special-instructions",
    role: "customer",
    category: "Orders",
    title: "Cooking instructions, allergies and preferences",
    content:
      "Add cooking or dietary notes (less spicy, no onion, allergy information, extra napkins) in the order instructions before checkout, and use Veg Mode to browse only vegetarian options. Restaurants try to honour requests but cannot always guarantee an allergen-free kitchen — for severe allergies, contact the restaurant directly or avoid the item. Note any allergy clearly in the instructions.",
    tags: ["allergy", "instructions", "spicy", "veg", "dietary", "preference"],
  },
  {
    seedKey: "cust-change-order",
    role: "customer",
    category: "Orders",
    title: "Change my address or add items after ordering",
    content:
      "Once an order is placed the address and items are usually locked because the restaurant starts preparing immediately. Small changes may be possible if the restaurant has not yet accepted — ask to chat with a human quickly with your order number. To add items, it is usually fastest to place a second order; a change of address after placing generally requires cancelling (if still allowed) and reordering.",
    tags: ["change address", "add items", "edit order", "modify"],
  },
  {
    seedKey: "cust-scheduled",
    role: "customer",
    category: "Orders",
    title: "Schedule an order for later",
    content:
      "At checkout you can choose to have your order delivered now or schedule it for a later time slot. Scheduled orders are sent to the restaurant so they are prepared close to your chosen time. You can see scheduled orders in your Orders list. Cancellation rules still apply once the restaurant begins preparing.",
    tags: ["schedule", "later", "pre-order", "time slot"],
  },
  {
    seedKey: "cust-restaurant-closed",
    role: "customer",
    category: "Orders",
    title: "Restaurant is closed or not accepting orders",
    content:
      "Restaurants show as closed outside their opening hours or when they temporarily stop taking orders (too busy, out of stock). You cannot place an order at a closed restaurant, but you can browse others that are open, or schedule for when it reopens if scheduling is offered. Opening hours are set by each restaurant.",
    tags: ["closed", "not accepting", "unavailable", "hours"],
  },
  {
    seedKey: "cust-min-order",
    role: "customer",
    category: "Orders",
    title: "Minimum order value",
    content:
      "Some restaurants and some coupons require a minimum order value. If your cart is below it, add more items to proceed or to unlock the offer — the cart shows how much more you need. Minimum order helps keep small deliveries viable for restaurants and riders.",
    tags: ["minimum order", "cart", "add more", "threshold"],
  },
  {
    seedKey: "cust-payment-failed",
    role: "customer",
    category: "Payments",
    title: "Payment failed but money was deducted",
    content:
      "If a payment fails but your bank shows a deduction, the amount is almost always auto-reversed by your bank or the payment provider within a few hours to a few business days, and no order is placed. If a Kada wallet payment failed, the balance is restored automatically. If you do not see the reversal after 3–5 business days, ask to chat with a human with the payment date and amount.",
    tags: ["payment failed", "deducted", "money gone", "reversal", "stuck"],
  },
  {
    seedKey: "cust-double-charge",
    role: "customer",
    category: "Payments",
    title: "I was charged twice for one order",
    content:
      "A genuine double charge for a single order is refunded once verified. Please check whether two separate orders were placed first. If it is truly a duplicate charge for one order, ask to chat with a human with the order number and both transaction references so we can reverse the extra charge.",
    tags: ["double charge", "charged twice", "duplicate", "refund"],
  },
  {
    seedKey: "cust-giftcards",
    role: "customer",
    category: "Payments",
    title: "Kada gift cards — buying and redeeming",
    content:
      "You can buy a Kada gift card for someone and they can redeem the code to top up their Kada wallet, then spend it on any order. Redeemed value is added to the wallet balance. Keep the gift-card code and PIN private — anyone with them can redeem the card. For a lost or unredeemed gift card, ask to chat with a human.",
    tags: ["gift card", "redeem", "voucher", "wallet", "code"],
  },
  {
    seedKey: "cust-account-privacy",
    role: "customer",
    category: "Account",
    title: "Change details, delete account and privacy",
    content:
      "Update your name, phone, email and saved addresses from your profile. To delete your account and associated data, use the account/privacy option in your profile or ask to chat with a human — deletion removes your profile and personal data subject to any legal retention of transaction records. Changing your login phone number may require re-verifying with an OTP.",
    tags: ["delete account", "privacy", "change phone", "email", "data"],
  },
  {
    seedKey: "cust-notifications",
    role: "customer",
    category: "Troubleshooting",
    title: "I am not getting order notifications",
    content:
      "Enable notifications for the Kada app in your phone's settings and keep them on inside the app's preferences. On iPhone, order progress also shows as a Live Activity on the lock screen and Dynamic Island. If notifications still do not arrive, reinstalling the latest app version and re-logging in refreshes the notification token.",
    tags: ["notifications", "alerts", "push", "not receiving"],
  },
  {
    seedKey: "cust-reorder",
    role: "customer",
    category: "Orders",
    title: "Reorder and favourites",
    content:
      "You can reorder a past meal from your Orders list, and save restaurants or dishes to Favourites for quick access next time. Reordering rebuilds the same cart so you can adjust items before checkout. Prices reflect the restaurant's current menu.",
    tags: ["reorder", "repeat", "favourites", "again"],
  },
  {
    seedKey: "cust-reservations",
    role: "customer",
    category: "Dine-in",
    title: "Booking a table (dine-in reservations)",
    content:
      "At participating restaurants you can Book a Table: pick a date, time slot, party size and seating preference. Some restaurants require a small refundable deposit and offer a pre-book discount on your final bill. Your reservations appear in your profile, where you can view or cancel them per the restaurant's policy.",
    tags: ["reservation", "book table", "dine-in", "booking"],
  },
  {
    seedKey: "cust-report-safety",
    role: "customer",
    category: "Safety",
    title: "Report a rider or restaurant / safety concern",
    content:
      "If you have a safety concern or misconduct to report about a rider or restaurant, use Report an issue on the order or ask to chat with a human immediately — serious safety issues are prioritised. Provide the order number and details. Your report is confidential and helps keep Kada safe.",
    tags: ["report", "safety", "misconduct", "complaint", "unsafe"],
  },
  {
    seedKey: "cust-charges-explained",
    role: "customer",
    category: "Payments",
    title: "Taxes, packaging and other charges",
    content:
      "Your bill can include the item total, applicable taxes (GST), a delivery fee based on distance, a small platform fee, and any restaurant packaging charge. Every charge is itemised in the bill before you pay. Discounts from coupons, Kada Gold and free-delivery offers are shown as separate deductions.",
    tags: ["taxes", "gst", "packaging", "platform fee", "bill", "charges"],
  },

  // ── Rider — additional real-world scenarios ────────────────────────────────
  {
    seedKey: "rider-accept-reject",
    role: "rider",
    category: "Orders",
    title: "Accepting or rejecting an order offer",
    content:
      "When an offer appears you have a short window to accept before it is re-offered to another rider. The offer shows the estimated earning and trip distance so you can decide. Accept to take it and head to the restaurant; let it lapse or decline to skip it. A very low acceptance rate can reduce the offers you receive, so accept what you can reasonably complete.",
    tags: ["accept", "reject", "decline", "offer", "acceptance rate"],
  },
  {
    seedKey: "rider-order-not-ready",
    role: "rider",
    category: "Delivery",
    title: "Order is not ready at the restaurant",
    content:
      "Because you are dispatched while the food is still cooking, you may reach the restaurant before the order is ready. Check in, confirm the order number, and wait for it to be marked ready. If the wait is unusually long or the restaurant cannot locate the order, use the in-app options or ask to chat with a human rather than leaving.",
    tags: ["not ready", "waiting", "restaurant", "pickup", "wait time"],
  },
  {
    seedKey: "rider-verification",
    role: "rider",
    category: "Delivery",
    title: "Pickup and delivery verification (OTP / photo)",
    content:
      "Follow the in-app pickup step to confirm you have collected the correct order, and complete the delivery step at drop-off. Some orders require a delivery OTP from the customer or a photo proof of delivery — enter the OTP the customer gives you or capture the photo as prompted. This protects you and the customer against disputes.",
    tags: ["otp", "photo", "proof", "pickup", "delivery", "verify"],
  },
  {
    seedKey: "rider-cancel-delivery",
    role: "rider",
    category: "Delivery",
    title: "Cancelling a delivery you accepted",
    content:
      "Only cancel an accepted delivery for a genuine reason (vehicle breakdown, safety, the restaurant cannot fulfil it). Use the in-app cancel/return flow so the order can be reassigned quickly — do not simply abandon it. Frequent cancellations affect your reliability and the offers you receive. For emergencies, contact support.",
    tags: ["cancel", "return", "abandon", "reassign", "reliability"],
  },
  {
    seedKey: "rider-undelivered",
    role: "rider",
    category: "Delivery",
    title: "Customer refused or order could not be delivered",
    content:
      "If the customer refuses the order or is unreachable after you have followed the call-and-wait process, use the app's undelivered/return flow and follow the instructions for the food and any COD cash. Do not keep or discard the order without recording the outcome in the app, so your earning and cash ledger stay correct.",
    tags: ["undelivered", "refused", "return", "unreachable", "failed"],
  },
  {
    seedKey: "rider-ratings",
    role: "rider",
    category: "Performance",
    title: "How rider ratings work",
    content:
      "Customers can rate the delivery after each order. A good rating comes from on-time, polite, careful deliveries and following instructions. Consistently low ratings can affect your standing and the orders you receive. If you believe a rating is unfair, mention the order to support.",
    tags: ["rating", "review", "stars", "performance", "feedback"],
  },
  {
    seedKey: "rider-incentives",
    role: "rider",
    category: "Earnings",
    title: "Incentives, surge and peak-hour pay",
    content:
      "During busy periods a surge can increase the per-order earning, and Kada may run incentives for completing a target number of deliveries or being online in high-demand areas and hours. Any active incentive and its conditions are shown in the app. Being online during meal-time peaks in busy zones is the best way to maximise earnings.",
    tags: ["incentive", "surge", "peak", "bonus", "extra pay"],
  },
  {
    seedKey: "rider-safety",
    role: "rider",
    category: "Safety",
    title: "Safety, accidents and SOS",
    content:
      "Your safety comes first. Ride carefully, wear a helmet, and never rush at the cost of safety. In an emergency use the in-app SOS/safety option if available and contact local emergency services. Report accidents, threats or harassment to Kada support as soon as you are safe, with details and the order number.",
    tags: ["safety", "accident", "sos", "emergency", "harassment"],
  },
  {
    seedKey: "rider-kyc",
    role: "rider",
    category: "Getting started",
    title: "Document verification and rejected documents",
    content:
      "To be approved you must upload valid documents (ID, driving licence, vehicle and bank/UPI details) in your profile. If a document is rejected, it is usually unclear, expired, or does not match your details — re-upload a clear, valid copy. Approval can take some time; you cannot receive orders until verified.",
    tags: ["kyc", "documents", "verification", "rejected", "licence", "approval"],
  },
  {
    seedKey: "rider-update-details",
    role: "rider",
    category: "Account",
    title: "Updating your UPI, bank or vehicle details",
    content:
      "Keep your payout UPI/bank details and vehicle information current in your profile so payouts reach you and orders match your vehicle. Changing bank or payout details may require re-verification for security. If a payout failed due to wrong UPI details, correct them and contact support to re-initiate.",
    tags: ["upi", "bank", "vehicle", "update", "details", "payout"],
  },
  {
    seedKey: "rider-best-hours",
    role: "rider",
    category: "Earnings",
    title: "When and where to earn the most",
    content:
      "Demand is highest around lunch and dinner and in dense restaurant/residential areas. Being online during these peaks, staying near clusters of restaurants, and keeping a high completion rate gets you more and better-paying offers. Watch for any surge or incentive shown in the app.",
    tags: ["best hours", "demand", "peak", "when online", "earn more"],
  },
  {
    seedKey: "rider-batched",
    role: "rider",
    category: "Delivery",
    title: "Handling more than one order at a time",
    content:
      "You may sometimes be offered a second nearby order to deliver along the way. Pick up each order at its restaurant, keep them clearly separated, and follow the app's sequence for drop-offs so each customer gets the right order. Each delivery earns separately.",
    tags: ["batched", "multiple", "two orders", "stacked"],
  },

  // ── Vendor — additional real-world scenarios ───────────────────────────────
  {
    seedKey: "vendor-onboarding",
    role: "vendor",
    category: "Getting started",
    title: "Registering your restaurant on Kada",
    content:
      "To start selling on Kada, sign up on the vendor app, enter your restaurant details, add your menu, set your hours, and complete verification (business and bank details). Choose a subscription plan on the Kada web dashboard to activate the account. Once approved and marked Open, your restaurant appears to nearby customers and can receive orders.",
    tags: ["register", "onboarding", "signup", "start", "new restaurant"],
  },
  {
    seedKey: "vendor-kyc",
    role: "vendor",
    category: "Account",
    title: "KYC, bank and document verification",
    content:
      "Verification requires valid business and bank documents so payouts can be settled to you. If a document is rejected it is usually unclear, expired or mismatched — re-upload a correct copy. Your restaurant cannot go live or receive payouts until verification is complete. For help, talk to a human.",
    tags: ["kyc", "verification", "bank", "documents", "gst", "fssai"],
  },
  {
    seedKey: "vendor-add-items",
    role: "vendor",
    category: "Catalog",
    title: "Adding and editing menu items",
    content:
      "Add items with a clear name, price, category, a good photo and a short description from the Menu screen. Accurate photos and descriptions increase orders and reduce complaints. You can use the AI menu import to speed up setup. Keep prices current, as the customer pays the price shown at order time.",
    tags: ["menu", "add item", "photo", "price", "description", "catalog"],
  },
  {
    seedKey: "vendor-out-of-stock",
    role: "vendor",
    category: "Catalog",
    title: "Marking items out of stock",
    content:
      "When you run out of a dish, mark it unavailable/out of stock so customers cannot order it — this prevents cancellations and refunds. Re-enable it when it is back. Keeping availability accurate protects your ratings and your acceptance rate.",
    tags: ["out of stock", "unavailable", "sold out", "availability"],
  },
  {
    seedKey: "vendor-prep-time",
    role: "vendor",
    category: "Orders",
    title: "Preparation time and keeping riders from waiting",
    content:
      "Set a realistic preparation time so a rider is dispatched to arrive close to when the food is ready. Accept orders promptly and mark them Ready as soon as they are packed. If riders regularly wait at your store, reduce the gap by accepting faster or adjusting prep time — long waits hurt delivery times and your ratings.",
    tags: ["prep time", "preparation", "rider waiting", "ready", "delay"],
  },
  {
    seedKey: "vendor-refund-dispute",
    role: "vendor",
    category: "Orders",
    title: "Refunds and disputes on an order",
    content:
      "If a customer reports a missing item, wrong item or quality issue, Kada reviews it and may issue a refund. Accurate order packing, correct items and good quality minimise disputes. To contest a specific refund or dispute, talk to a human with the order number and details — repeated valid complaints affect your standing.",
    tags: ["refund", "dispute", "complaint", "chargeback", "missing"],
  },
  {
    seedKey: "vendor-commission",
    role: "vendor",
    category: "Payments",
    title: "Commission and fees",
    content:
      "Kada charges a commission and applicable fees on orders, which are deducted before your payout. Your net revenue is what remains after commission, taxes and any adjustments. You can see your Kada order revenue in Kada Analytics. For a breakdown of a specific settlement, talk to a human with the date range.",
    tags: ["commission", "fees", "payout", "deduction", "revenue"],
  },
  {
    seedKey: "vendor-gst",
    role: "vendor",
    category: "Payments",
    title: "Tax (GST) settings and invoices",
    content:
      "Configure your tax settings (GST rate, inclusive or exclusive) so bills are calculated correctly for customers. Kada can generate GST reports for your Kada orders to help with filing. Ensure your tax details and registration are accurate. For tax report questions, talk to a human.",
    tags: ["gst", "tax", "invoice", "report", "filing"],
  },
  {
    seedKey: "vendor-promotions",
    role: "vendor",
    category: "Marketing",
    title: "Running offers and promotions",
    content:
      "Use the Marketing tools to run discounts and offers that attract more customers on Kada. You can also opt in to platform promotions and, if invited, become a Kada Gold partner restaurant offering members a special discount. Well-timed offers during peak hours and on popular items drive the most orders.",
    tags: ["offers", "promotions", "discount", "marketing", "gold partner"],
  },
  {
    seedKey: "vendor-ratings",
    role: "vendor",
    category: "Performance",
    title: "Ratings and reviews",
    content:
      "Customers rate the food and the overall experience. Good ratings come from accurate orders, quality, correct packing and staying open during your listed hours. Low ratings and frequent cancellations reduce your visibility. Watch feedback in your dashboard and address recurring issues.",
    tags: ["ratings", "reviews", "feedback", "quality", "visibility"],
  },
  {
    seedKey: "vendor-outlets",
    role: "vendor",
    category: "Account",
    title: "Managing multiple outlets or branches",
    content:
      "If you run more than one location, you can manage outlets/branches from the Outlets section, each with its own menu, hours and orders. Sub-accounts let branch managers operate their outlet. This keeps each location's catalog and reporting separate.",
    tags: ["outlets", "branches", "locations", "multi", "cloud kitchen"],
  },
  {
    seedKey: "vendor-holiday",
    role: "vendor",
    category: "Account",
    title: "Temporarily closing or holiday mode",
    content:
      "To stop receiving orders temporarily (holiday, staff shortage, kitchen issue), set your restaurant to Closed or use holiday/temporary-off mode in Settings instead of ignoring orders. Reopen when you are ready. Ignoring incoming orders hurts your ratings, so always toggle closed when you cannot serve.",
    tags: ["closed", "holiday", "temporary", "pause", "off"],
  },
  {
    seedKey: "vendor-serviceability",
    role: "vendor",
    category: "Delivery",
    title: "Delivery radius and serviceability",
    content:
      "Your restaurant is shown to customers within the serviceable delivery distance. Orders too far away may not be offered, to keep delivery times and fees reasonable. If you believe your serviceable area is wrong, talk to a human.",
    tags: ["radius", "serviceability", "distance", "coverage", "area"],
  },
  {
    seedKey: "vendor-reservations",
    role: "vendor",
    category: "Dine-in",
    title: "Managing table reservations",
    content:
      "If you accept dine-in bookings, manage incoming table reservations from the Reservations section — accept, view party size and time slot, and set any deposit or pre-book discount. Keeping availability and confirmations up to date gives guests a smooth booking experience.",
    tags: ["reservations", "table booking", "dine-in", "deposit"],
  },

  // ── Host app (Kada Stay — hotels & properties) ─────────────────────────────
  {
    seedKey: "host-getting-started",
    role: "host",
    category: "Getting started",
    title: "Set up your property on Kada Stay",
    content:
      "Welcome to Kada Stay (Kada Host). To go live: complete onboarding and property KYC, create your listings under Listings, add each room type with photos, capacity and base price under Rooms, set your availability calendar, and connect your bank account for payouts. Once your property passes review you can start accepting bookings. Use the dashboard to track occupancy, revenue and today's arrivals/departures.",
    tags: ["setup", "onboarding", "getting started", "property", "listing"],
  },
  {
    seedKey: "host-add-rooms",
    role: "host",
    category: "Catalog",
    title: "Add and manage rooms and listings",
    content:
      "Under Listings and Rooms, create each room type (e.g. Deluxe, Suite), set maximum occupancy, bed configuration, amenities and high-quality photos. Set a base nightly price per room type. Keep at least 5 clear photos per listing — well-lit rooms with accurate descriptions get more bookings and better reviews. You can mark rooms out of service for maintenance from the Rooms section.",
    tags: ["rooms", "listings", "add room", "amenities", "photos"],
  },
  {
    seedKey: "host-pricing",
    role: "host",
    category: "Payments",
    title: "Pricing and dynamic rates",
    content:
      "Set a base price per room type, then adjust rates by season, weekends and demand. Use dynamic pricing to raise rates on high-demand dates and offer last-minute or length-of-stay discounts to fill unsold inventory. Review your booking window (how far ahead guests book) to time your discounts. Keep taxes (GST) configured correctly so guest totals and your payouts are accurate.",
    tags: ["pricing", "rates", "dynamic pricing", "discounts", "revenue"],
  },
  {
    seedKey: "host-bookings",
    role: "host",
    category: "Orders",
    title: "Managing bookings and availability",
    content:
      "Incoming bookings appear under Bookings with guest name, dates, room type, guests and amount. Keep your availability calendar accurate to avoid overbooking — block dates that are unavailable. Confirm bookings promptly. Each booking shows the check-in and check-out dates and the payout you'll receive after commission. You can view upcoming arrivals and departures on the dashboard.",
    tags: ["bookings", "availability", "calendar", "overbooking", "arrivals"],
  },
  {
    seedKey: "host-checkin",
    role: "host",
    category: "Orders",
    title: "Check-in and check-out",
    content:
      "On the guest's arrival date, mark them checked-in from the booking or Front Desk. Verify the guest's ID as required by local regulations, assign the room, and note any deposit collected. On departure, mark check-out so the room returns to your available inventory and housekeeping is notified. Standard check-in is from 2 PM and check-out by 11 AM unless you set otherwise.",
    tags: ["check-in", "check-out", "front desk", "arrival", "departure"],
  },
  {
    seedKey: "host-guests",
    role: "host",
    category: "Quality",
    title: "Guest management and complaints",
    content:
      "Manage guest profiles and messages under Guests and Messages. Respond to guest queries quickly. For complaints, use the BLAST approach: Believe, Listen, Apologise, Satisfy, Thank — acknowledge the issue promptly, offer a concrete solution or fair compensation, and follow up to confirm the guest is satisfied. A quick, gracious response protects your rating.",
    tags: ["guests", "complaints", "reviews", "service", "hospitality"],
  },
  {
    seedKey: "host-housekeeping",
    role: "host",
    category: "Performance",
    title: "Housekeeping and room status",
    content:
      "Use Housekeeping to track room cleaning status — dirty, in-progress, clean and inspected. Rooms are flagged for cleaning automatically after check-out. Keep rooms marked clean before they're sold again. Assign housekeeping tasks to staff and monitor turnaround so rooms are ready for the next guest on time.",
    tags: ["housekeeping", "cleaning", "room status", "turnaround", "staff"],
  },
  {
    seedKey: "host-payouts",
    role: "host",
    category: "Earnings",
    title: "Payouts and settlement",
    content:
      "Your booking revenue, minus the Kada Stay commission and applicable taxes, is settled to the bank account you added during onboarding. Track earnings and pending payouts on the dashboard. Make sure your bank account holder name, account number and IFSC are correct and your KYC is approved — payouts cannot be released until KYC is verified.",
    tags: ["payouts", "settlement", "earnings", "bank", "commission"],
  },
  {
    seedKey: "host-reviews",
    role: "host",
    category: "Performance",
    title: "Ratings and reviews",
    content:
      "Guests rate their stay after check-out. Your overall rating affects your ranking and visibility in Kada Stay search. Maintain clean rooms, accurate listings and responsive service to keep a high rating. Respond professionally to reviews — thank guests for positive ones and address concerns constructively in negative ones.",
    tags: ["reviews", "ratings", "reputation", "ranking", "visibility"],
  },
  {
    seedKey: "host-cancellations",
    role: "host",
    category: "Orders",
    title: "Cancellations and refunds",
    content:
      "Set a clear cancellation policy for your property (e.g. free cancellation up to 48 hours before check-in). When a guest cancels within the free window, the booking is refunded per policy and the dates return to your calendar. For no-shows or late cancellations, your policy determines any charge. Keep your policy visible so guests book with confidence.",
    tags: ["cancellation", "refund", "no-show", "policy"],
  },
  {
    seedKey: "host-occupancy",
    role: "host",
    category: "Insights",
    title: "Improving occupancy and revenue",
    content:
      "To raise occupancy: keep your calendar and pricing current, offer last-minute deals for unsold nights, create length-of-stay promotions, and ensure your photos and listings are attractive and accurate. Track your occupancy rate and average daily rate (ADR) on Analytics. A well-reviewed, fairly priced, well-photographed property with real-time availability consistently outperforms.",
    tags: ["occupancy", "revenue", "adr", "analytics", "promotions"],
  },
  {
    seedKey: "host-staff",
    role: "host",
    category: "Account",
    title: "Staff and roles",
    content:
      "Add front-desk, housekeeping and manager staff under Staff and give each the access they need. Schedule staff around your expected occupancy and arrivals so there's always coverage at check-in peaks and a manager on call. Clear roles keep check-ins, cleaning and guest service running smoothly.",
    tags: ["staff", "roles", "scheduling", "team", "permissions"],
  },
];

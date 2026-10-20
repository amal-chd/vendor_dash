
---

# Kada Stay: Airbnb-Quality Rebuild

I completely redesigned and rebuilt the Kada Stay customer experience into a polished, map-first property discovery marketplace inspired by modern accommodation platforms (like Airbnb), moving away from the monolithic and basic design that was previously implemented.

## 1. Customer App (Phase 1)
- **Monolith Extraction**: Split the massive 3,100+ line `kada_stay_view.dart` into a modular 15-file architecture (`stay_map_view`, `stay_list_view`, `stay_filters_sheet`, `stay_models`, etc.).
- **Map-First UI**: Introduced an interactive Google Map view that synchronizes with a horizontal carousel of property cards (swiping a card moves the map pin, and vice-versa).
- **Custom Price Markers**: Replaced generic map pins with custom-drawn dynamic price markers (e.g. "₹2,500").
- **Property Cards**: Introduced horizontal, vertical, and map-compact property cards with image carousels, dot pagination, and wishlist states.
- **Advanced Filtering**: Built a detailed `stay_filters_sheet.dart` for price ranges, property types (Villas, Cottages, etc.), and amenities, plus a `stay_guest_sheet.dart` with stepper controls.

## 2. Backend Infrastructure (Phase 2)
- **Geospatial Search**: Integrated `ngeohash` to generate Geohashes (`indexHotelGeohash`) and implemented `searchStays` for radius and bounding box searches based on the map viewport.
- **Availability & Pricing Engine**: Created `checkAvailability` and `calculatePricing` functions to read from a new `hotels/{id}/rooms/{roomId}/availability` subcollection, calculating dynamic totals, cleaning fees, and service fees.
- **Recommendations**: Implemented `getSimilarStays` and `getPopularStays` logic.

## 3. Admin Panel (Phase 3)
Built a comprehensive 7-page KadaStay module in the React admin dashboard (`src/pages/admin/stay/`):
1.  **Properties** (`StayProperties.tsx`): Approval workflows, featuring toggles, and property table.
2.  **Bookings** (`StayBookings.tsx`): Cross-property booking streams and status management.
3.  **Hosts** (`StayHosts.tsx`): Host KYC, properties count, and suspension controls.
4.  **Reviews** (`StayReviews.tsx`): Moderation of guest reviews.
5.  **Amenities** (`StayAmenities.tsx`): Global taxonomy configuration for host selection.
6.  **Destinations** (`StayDestinations.tsx`): Featured destination cards (Goa, Coorg, etc.).
7.  **Analytics** (`StayAnalytics.tsx`): Platform-wide revenue, conversion, and occupancy metrics.

## 4. Host App Enhancements (Phase 4)
- **Listing Wizard** (`create_listing_wizard.dart`): Replaced the basic form with an 8-step wizard supporting dynamic location pinning, strict/moderate cancellation policies, house rules (pets/smoking), and expanded property types.
- **Dynamic Pricing** (`dynamic_pricing_screen.dart`): Added a dedicated pricing screen for weekend multipliers and long-stay discounts (7+ nights / 28+ nights).
- **Review Management** (`reviews_management_screen.dart`): Provided hosts the ability to view guest reviews and post public host replies.

# Kada Suite — Authentication (canonical reference)

This is the single source of truth for how auth works across the four Kada apps.
Keep it updated when auth changes, so the apps don't re-diverge.

## Shared identity model

All four apps run on **one Firebase project — `kada-restaurant-os-v1`** — so they
share **one Firebase Auth identity pool**. The same phone number or email resolves
to the **same `uid`** in every app. Role/profile data is **siloed in per-role
Firestore collections** (a user can hold different profiles per app under the same uid).

| App | Package | Android applicationId | Profile collection | Auth methods | Architecture |
|---|---|---|---|---|---|
| Customer | `kada_customer` | `com.thekada.app` | `customer_users` | email · Google · Apple · phone | `auth_gate` + `screens/auth/*` |
| Rider | `kada_rider` | `com.thekada.kada_rider` | `delivery_users` | email · Google · Apple · phone | `auth_gate` + `screens/auth/*` |
| Vendor | `kada_dine` | `com.kada.restaurant_os.vendor` | `restaurants` | email · Google · Apple · phone | `auth_wrapper` (+ IAP + staff claims) |
| KadaStay | `kadastay` | `com.kadastay.app` | `users` (+ `hotels`) | email · Google · Apple | Clean Arch + Riverpod + freezed |

Custom claims: rider gets `{ rider: true }` on approval; vendor staff get
`{ staff, restaurantId, staffDocId }`.

## Canonical flow (all apps)

```
Splash
  → [first launch only] Intro Onboarding      (SharedPreferences 'onboarding_completed')
  → Welcome
  → { Login | Signup }                        (email · Google · Apple · [phone])
  → [profile / business setup if incomplete]  (customer/rider: ProfileSetup · vendor: Signup+IAP · host: hotel wizard)
  → [rider only] StatusGate                   (pending / rejected / suspended → gate; approved → shell)
  → Shell
```

The gate in each app checks the onboarding pref **first** (Stateful widget),
then Firebase `authState`, then profile completeness, then role/status.

## Canonical building blocks (reuse — don't reinvent)

- **Friendly errors:** `customer_mobile_app/lib/utils/auth_error_helper.dart`
  (`AuthErrorHelper.getUserMessage(error)`) is the **canonical** implementation.
  - Rider & Vendor keep a byte-for-byte copy at `lib/utils/auth_error_helper.dart`.
  - KadaStay has an equivalent central mapper in
    `lib/core/errors/error_handler.dart` (`_authErrorMessage`), kept aligned in wording.
  - Messages are **non-enumerating**: `user-not-found` / `wrong-password` /
    `invalid-credential` collapse to one "incorrect email or password" message.
- **Intro onboarding:** `customer_mobile_app/lib/screens/onboarding/onboarding_screen.dart`
  is the template (single hero: logo, fanned emoji cards, tagline, Get Started, stats bar).
  Rider & Vendor have themed copies at `lib/screens/onboarding/onboarding_screen.dart`.
  Onboarding pref key is **`onboarding_completed`** (bool, `SharedPreferences`) in every app.
- **Per-app visuals** live in each app's `widgets/auth_visuals.dart` and are
  intentionally themed per brand — do **not** unify these.

## Config invariants (must always hold)

1. Exactly one Firebase project: **`kada-restaurant-os-v1`** (android `google-services.json`,
   iOS `GoogleService-Info.plist`, and Dart `firebase_options.dart` must all agree).
2. Each app's Android `applicationId` **must** have a matching client entry in its
   `google-services.json` (and the iOS bundle id in its `GoogleService-Info.plist`).
3. SHA-1 **and** SHA-256 registered for every Android app (required for Google Sign-In
   and phone/OTP).

## Open follow-ups — require the Firebase Console (cannot be done in code alone)

1. **Rider Android mismatch:** `applicationId` is `com.thekada.kada_rider`, but its
   `google-services.json` only registers `com.thekada.kadaRider`. Register
   `com.thekada.kada_rider` under `kada-restaurant-os-v1` (with SHA-1/256) and
   re-download `google-services.json`. *(Or, if the app is unpublished, rename the
   applicationId to the already-registered id.)*
2. **KadaStay → shared project:** native config currently points at a **separate**
   `kada-stay` project. Before switching, confirm `kada-stay` has **no live users**
   (otherwise a Firebase Auth export/import migration is required). Then register
   `com.kadastay.app` (Android) + the iOS bundle under `kada-restaurant-os-v1`,
   re-download `google-services.json` + `GoogleService-Info.plist`, and run
   `flutterfire configure` so native + Dart agree.
3. Ensure Email/Password, Google, Apple, and Phone providers are enabled in
   `kada-restaurant-os-v1` Auth settings.

## Notes / tech debt (not auth-blocking)

- `vendor_mobile_app/lib/screens/phone_auth_screen.dart` is legacy and unreferenced —
  candidate for deletion (phone auth is handled inline in `login_screen.dart`).
- Each app carries some pre-existing lints unrelated to auth (see `flutter analyze`);
  the auth files themselves are analyzer-clean.

# The Kada Design System — "Kada Ember"

> Shared design language for the **Customer**, **Delivery (rider)**, **Vendor** and
> **Admin** applications. Derived from a 51-screenshot audit of a best-in-class
> delivery app (Phase 1), then re-expressed as The Kada's own identity (Phase 2).
> **This is not a clone spec** — it captures the *underlying* system (hierarchy,
> rhythm, motion, states) and rebuilds it with Kada branding.

---

## Phase 1 — Design Audit (what the reference actually does)

Observations grounded in the 51 reference screenshots (IMG_1467–IMG_1518).

### 1. Color system
- **Canvas is near-black** (~`#0B0B0D`), not gray. Cards sit 1–2 steps lighter
  (~`#161719`, `#202124`). Elevation is communicated by *surface lightness*, not shadow.
- **One saturated brand accent** (a coral red) used sparingly: CTAs, active filter
  states, links ("Claim now ▸", "View menu ▸"), price/ADD buttons. Almost never as
  a background wash — the app stays dark and lets **food photography** be the color.
- **Green is semantic, never decorative**: rating pills (`★ 4.5` on deep green),
  veg marks, "On time" pills, the order-status header while an order is healthy.
- **Gold/amber = membership tier** (Gold wordmark, crown badges, "saved ₹56" pill)
  and *warnings* ("CLOSING SOON", "Delivery partner might be driving").
- **Blue = information/offers** ("Special prices unlocked", coupon celebration,
  savings pills, "It's raining…" info rows).
- Text ramp: near-white primary, ~60% gray secondary, ~40% hints.

### 2. Typography hierarchy
- One geometric-humanist sans across the app; hierarchy via **weight + size, not fonts**.
- Display (screen titles like restaurant name): ~28–32pt, w800–900, tight tracking.
- Section titles: ~20–22pt w800 ("Most ordered together", "Recommended for you").
- **Letter-spaced ALL-CAPS micro-labels** for wayfinding: "EXPLORE MORE",
  "WHAT'S ON YOUR MIND?", "SAVINGS TILL NOW", "CANCELLATION POLICY" — ~12–13pt,
  +1–3pt tracking, muted color. This is the single most recognizable text pattern.
- Body 13–15pt w500–600; prices bold; links colored w700, often with "▸".
- Playful voice in system moments: loading quotes ("Sleep 8 hours, but dream 24/7"),
  script accent type for AI features ("Think it, search it").

### 3. Spacing & grid
- Base unit **4pt**; dominant rhythm 8/12/16.
- Screen gutter **16pt**; card internal padding 16–20pt; 10–14pt between cards.
- Lists are **single-column, full-bleed cards**; grids only for category/dish
  imagery (3-col "what's on your mind" tiles).
- Generous vertical air between sections (24–32pt) — sections breathe; density
  lives *inside* cards, not between them.

### 4. Component system (recurring parts)
- **Search bar**: pill/rounded-16, dark fill, leading search icon, trailing mic,
  hint is a *suggestion* ("Search \"sweet cravings\"") not a label.
- **Filter chips row**: horizontally scrolling, first chip "Filters ⏷" with icon;
  active chip = tinted fill + accent border. Appears identically on home,
  restaurant, offers, orders — a true system component.
- **Rating pill**: green rounded rect, star + value, "By 13K+" caption below.
- **Veg/non-veg mark**: bordered square with dot/triangle — always leading the item name.
- **ADD stepper**: outlined red "ADD +" morphing to filled red `− 1 +` when in cart;
  "customisable" caption beneath.
- **Trust chips**: "✓ Last 100 orders without complaints", "✓ Frequently reordered".
- **Offer strip**: icon + "Flat ₹40 OFF above ₹399" + "2 offers ⏷" collapsed row
  pinned under the search bar in menus.
- **Live-order pill**: floating bottom bar with restaurant, status, "arriving in
  N mins" green pill — persists across the whole app while an order is active.
- **Hanging coupon tags** (offers page), **wavy-edged savings banner** (bill),
  **dashed-border coupon input** — offers get playful, tactile shapes.

### 5. Navigation pattern
- Shallow tab architecture + deep push stacks. Persistent bottom bar; a floating
  pill switcher (Delivery/Dining) on home.
- **Back is always a circled glass button** top-left over imagery.
- In long menus: a floating **"Menu" FAB** opens a category jump-sheet (name +
  item count, current section highlighted) — list scanning at scale.
- Sticky elements: search + filters pin on scroll; section headers pin while
  their list scrolls beneath (menu).

### 6. Cards & lists
- Restaurant card: full-width photo, bookmark top-right, bottom-left overlay pill
  (dish + price) over a scrim, then name + green rating; meta line (⏱ time · km ·
  fee) and a blue offer badge row.
- Menu item row: left text column (veg mark → name → "Highly reordered" progress
  → price → 2-line description "…more" → bookmark/share circles), right 110–130pt
  photo with ADD overlapping its bottom edge. **Dashed dividers** between items.
- Combo cards ("Most ordered together"): two-image split + "Ordered by 30+ customers" gold caption.

### 7. Search UX
- Search screen = **destination**, not overlay: recent + trending + AI suggestion
  chips (sparkle icon, gradient border), "WHAT'S ON YOUR MIND?" photo grid.
- **Voice search**: full-screen "Listening…" overlay w/ pulsing mic rings.
- In-restaurant search scopes to the menu ("Search in The Voyager").

### 8. Filter UX
- One-tap value filters (Veg, Non-veg, Under ₹200, Highly reordered) + a "Filters"
  sheet for the long tail. Filters **persist visually** (active state) wherever applied.

### 9. Cart / Checkout UX
- Cart is a **savings narrative**: header celebrates ("You saved ₹100, including
  ₹60 with Gold 🥳"), then upsell rail ("Special prices unlocked"), applied-coupon
  row with green check + Remove, delivery details block (ETA + "Schedule it",
  address + edit, contact), **Total Bill row with strikethrough + savings pill**,
  donation module, letter-spaced CANCELLATION POLICY fine print.
- **Coupon celebration**: full-screen spotlight (badge + rays + "✦ EXCLUSIVELY FOR
  YOU ✦") → APPLY → confetti "✅ applied / You saved ₹40 / Woohoo! Thanks" dialog.
- Sticky pay bar: left = payment method switcher ("PAY USING ⏶ / Google Pay UPI"),
  right = big red **"₹536 TOTAL · Place Order ▶"**.

### 10. Payment UX
- Grouped list: RECOMMENDED / CARDS / UPI / WALLETS / PAY LATER / NETBANKING /
  COD — white icon tiles on dark rows, chevron to pay, `+` to add.
- Disabled methods stay visible with an inline reason bubble ("COD is currently
  unavailable for you") + advisory footnote.
- Processing = calm dark screen, spinner + "you will be redirected automatically."

### 11. States (empty/error/loading/success)
- **Loading screens use wit**: full-dark screen, centered one-liner quote +
  small brand-red spinner. Feels human, masks latency.
- Skeletons: gray stacked-card silhouettes (purchase history) — shimmer implied.
- Success = celebration: confetti, treasure chest reward moment, wavy savings banner.
- Failure is factual + actionable: "Payment failed / refund within 30 mins" +
  Reorder button right there.

### 12. Bottom sheets & dialogs
- Sheets everywhere (item detail, category jump, restaurant actions, location
  picker) — top radius ~28, drag affordance, **the page behind visibly dims with a
  floating ✕ between page and sheet**.
- Item sheet: hero image → veg mark + name + bookmark/share → description →
  add-ons w/ inline ADD → "Add a cooking request" textarea with chip presets →
  sticky `stepper + Add item — ₹223` bar.
- Dialogs are compact, centered, single-action ("Share order tracking" → Share now).

### 13. Motion principles
- Motion is **feedback, not decoration**: content fades/slides up on entrance
  (staggered rails), steppers morph in place, totals roll, sheets spring.
- Continuity: tapping a card grows it into the detail (container transform);
  collapsing headers pin the title.
- Celebrations reserved for *earned* moments (coupon, reward, delivery done).

### 14. Gestures & micro-interactions
- Horizontal rails everywhere; pull-to-refresh; sheet drag-to-dismiss; page-dot
  carousels; press states scale slightly; bookmark/heart toggles pop.

### 15. Notifications, Dynamic Island, Live Activities
- Active order = **ambient presence**: Dynamic Island live activity (logo pill)
  during the whole order; in-app floating live-order bar; map tracking screen
  with colored status header (green healthy / dark-blue rain / brown high-demand).
- Tracking header: restaurant name, status headline ("Preparing your order",
  "Order will be picked up shortly"), "Arriving in 24 mins • On time" pill + refresh.
- **Context-aware theming**: rain animates over header & rider card with a safety
  note; high-demand banner explains rider batching. Notifications explain *why*.
- Rider card: avatar, name, "320 orders delivered", 4.8★, message input + call.

### 16. Blur, glass, shadows, elevation
- Glass = **circled icon buttons over imagery** and frosted overlays; used
  surgically, not on every card.
- Dark theme ⇒ shadows are soft, large-radius, low-alpha; **elevation primarily by
  surface tone**; colored glows only under brand CTAs and gold rows.

### 17. Visual hierarchy recipe
1. Photography first (large, saturated, cropped tight).
2. One accent color reserved for action.
3. Micro-labels (caps + tracking) name each zone.
4. Semantic colors carry meaning (green trust, gold reward, blue info).
5. Dark canvas everywhere so 1–4 pop.

---

## Phase 2 — The Kada Design Language ("Kada Ember")

Same *bar*, different *voice*. Kada is a Kerala-born, chef-first brand: the mood
is **"embers at night"** — charcoal surfaces, ember red, brass gold — with
Malayali warmth in copy ("Fresh from the kada", "Chetta's on the way!").

### Identity tokens (single source of truth)

| Token | Value | Use |
|---|---|---|
| `ember` (primary) | `#EF4F5F` → pressed `#E23744` | CTAs, active states, links |
| `emberBright` | `#FF6B78` | highlights, glows |
| `charcoal` (bg) | `#0B0B0C` | app canvas |
| `surface` / `surfaceHigh` / `surfaceLow` | `#161719` / `#202124` / `#0F1011` | card elevation ramp |
| `ink` / `sub` / `faint` | `#F4F4F6` / `#9A9AA2` / `#6C6C74` | text ramp |
| `border` | `#262629` | hairlines |
| `leaf` / `ratingGreen` | `#3AB757` / `#267E3E` | veg, ratings, on-time |
| `brass` / `brassDeep` | `#E7C873` / `#B8860B` | Kada Gold tier, rewards |
| `info` | `#4C82F7` | offers/savings/info |
| `danger` | `#E23744` | errors, destructive |

Gradients: `brandGradient` (ember), `goldGradient` (brass), `headerWash`
(charcoal-red → canvas), `imageScrim` (transparent → 80% black).
Implemented in `customer_mobile_app/lib/theme/app_theme.dart` (`AppColors`,
`AppShadows`) — mirror in rider/vendor themes.

### Typography — Plus Jakarta Sans everywhere
- `display` 32/w900/-1.2 · `title` 22/w800/-0.5 · `heading` 17/w800
- `label` 12.5/w900/+1.2 **UPPERCASE** (the Kada zone-label)
- `body` 14/w600 · `caption` 12/w600 sub · `price` w800 tabular
- Buttons 15.5/w800/+0.2. Never mix families; hierarchy = weight/size/tracking.

### Spacing / radius / elevation tokens
- Space: `xs 4 · s 8 · m 12 · l 16 · xl 24 · xxl 32`; screen gutter 16.
- Radius: `chip 12 · card 20 · sheet 28 · pill 999`; hero imagery 20.
- Elevation: tone-first (surfaceLow→surface→surfaceHigh); `AppShadows.card`
  (soft 18-blur) · `.floating` (26) · `.glow(color)` for CTAs/gold only.
- Touch targets ≥ 44×44pt, list rows ≥ 56pt.

### Motion tokens (`widgets/motion.dart`)
- Durations: `fast 180ms · base 320ms · slow 520ms`; stagger 40–55ms/item, cap 12.
- Curves: `easeOutCubic` (emphasized), `easeOutQuart` (decelerate),
  `easeOutBack` only for playful pops (hearts, badges).
- Primitives: `FadeThroughTransitionsBuilder` (all routes), `AppMotion.entrance(i)`
  (staggered fade-up), `Pressable` (press-scale 0.97), `Shine` (gloss sweep),
  `CountUpText` (rolling totals), `ConfettiBurst` (earned moments only),
  `AppLoader` (3-dot bounce), `SkeletonBox`/`RestaurantCardSkeleton` (dark shimmer).
- Rules: animate **position/opacity/scale only** (no layout thrash), one
  celebration per journey, everything interruptible, respect reduced-motion.

### Voice & states
- Loaders speak Kada: rotating one-liners ("Good food takes exactly this long."),
  small ember spinner beneath — never a bare spinner on a blank screen.
- Empty states: emoji-scale glyph + one warm sentence + one CTA.
- Errors: what happened + what we did ("Refund on the way") + retry.
- Celebrations: confetti/gold shine only for coupon applied, reward unlocked,
  order delivered.

### Signature Kada patterns (ours, not theirs)
1. **Ember underline** — active tabs/categories get a 22×2.5 ember bar (already
   live on home categories).
2. **Zone labels** — caps+tracking micro-headers name every section.
3. **Live-order ribbon** — app-wide floating status bar + Dynamic Island continuity.
4. **Brass tier** — Kada Gold uses brass gradient + crown, shine sweep on entry.
5. **Chef's trust row** — "✓ 100 clean orders" style chips under restaurant titles.
6. **Glass only over photos** — dark-glass circle buttons (back/share/heart).
7. **Savings narrative** — cart always tells "you saved X" with rolling numbers.

### Per-app dialects
Every app shares **one typeface (Plus Jakarta Sans), one spacing/radius/motion
scale, and one set of semantic colors** (success/warning/error/info). What each
app is free to own is a **brand primary** — the four dialect accents below are
official and intentional, not drift. Ember stays the family signature (loaders,
celebrations, the shared marketing surface); each app leads with its own primary.

| App | Brand primary | Character |
|---|---|---|
| **Customer** | ember `#EF4F5F` (pressed `#E23744`) | full expression above; the reference |
| **Rider** | blue `#2563EB` | bigger type (body 16+), giant thumb targets, green/red availability, minimal chrome while riding — *speed over beauty* |
| **Vendor** | slate `#0F172A` + gold `#D4AF37` + violet `#7C3AED` | `surfaceHigh` density, status-chip-driven live queue, large accept/ready buttons for kitchen gloves |
| **Host (KadaStay)** | teal / KadaStay | calm hospitality surfaces, revenue/occupancy dashboards |
| **Admin (web)** | ember (Tailwind) | tokens map to Tailwind config; same semantic colors |

---

## Component inventory (Phase 10 target)

`lib/widgets/kada_ui.dart` (customer, shared-by-copy to rider/vendor):
`KadaButton` (primary/tonal/ghost + loading morph) · `SectionLabel` ·
`KadaChip` · `VegMark` · `RatingPill` · `AddStepper` · `PriceText` ·
`DashedDivider` · `GlassIconButton` · `StatusPill` · `GoldBadge` ·
`KadaEmptyState` · `KadaErrorState` · `WittyLoader` · `KadaSearchBar` ·
`OfferStrip` · `KadaSheetHandle`.

Existing motion primitives stay in `widgets/motion.dart`.

## Quality gates (Phases 11–13)
- `flutter analyze` clean on all apps; consts everywhere; `CachedNetworkImage`
  for all remote images; `ListView.builder`/slivers for all long lists.
- Semantics labels on icon-only buttons; ≥44pt targets; text scales to 1.3
  without overflow on key screens.
- No blur inside scrolling lists; celebrations are one-shot painters (no
  particle packages); IndexedStack keeps tab state (already in place).

---

## Appendix — Cross-app conformance audit (2026-08-29)

The spec above is the *intent*. This is the *actual* state of each app, so
unification work has a truthful baseline. Status: ✅ conforms · ⚠️ partial · ❌ off-spec.

| App | Primary (brand, ratified) | Typeface | Token classes | Status |
|---|---|---|---|---|
| **Customer** | ember `#EF4F5F` | Plus Jakarta Sans | `AppSpace` `AppRadius` `AppShadows` + `design_system/` (glass) | ✅ reference impl |
| **Rider** | blue `#2563EB` | Plus Jakarta Sans | `RiderColors` + `buildRiderTheme` (no spacing/radius classes) | ✅ font + color; ⚠️ inline spacing |
| **Vendor** | slate `#0F172A` + gold `#D4AF37` + violet `#7C3AED` | Plus Jakarta Sans | `buildVendorTheme` (local consts; no token classes) | ✅ font + color; ⚠️ no token classes |
| **Host** | teal / KadaStay | Plus Jakarta Sans (bundled variable) | `AppSpacing` (`sm/md/base/lg`) `AppRadius` (`sm/md`) | ✅ font + color; ⚠️ different token names |
| **Admin (web)** | ember (Tailwind) | Tailwind stack | shadcn tokens | ✅ per "tokens → Tailwind" |

### Divergences — status

1. **Typography — ✅ RESOLVED (2026-08-29).** All four apps now render Plus Jakarta
   Sans. Vendor migrated off Inter+Outfit (1,160 `GoogleFonts.*` call-sites →
   `plusJakartaSans`); Host migrated off bundled Inter to a bundled PJS variable
   font (wght 200–800; `fontWeight` drives the axis) across 139 refs. Monospace
   (vendor `robotoMono`) and PDF-export Noto fallbacks are deliberate exceptions.
   *Remaining:* an on-device visual pass on vendor & host to confirm no metric
   regressions.

2. **Color — ✅ RATIFIED (2026-08-29).** The four per-app primaries (customer
   ember · rider blue · vendor slate+gold · host teal) are now official dialects,
   recorded in *Per-app dialects* above. Shared across all apps: one typeface, the
   spacing/radius/motion scale, and the semantic colors. No code change — the
   drift was intentional identity; the spec now says so.

3. **Tokens — ⬜ OPEN (the remaining structural item).** Spacing *values* already
   align (4/8/12/16/24/32), but: rider & vendor have **no** `AppSpace`/`AppRadius`
   classes (inline magic numbers); host uses different names (`sm/md/base/lg` vs
   the canonical `s/m/l/xl`). → Adopt the canonical `AppSpace`/`AppRadius` names in
   all four Flutter apps so tokens are portable. Motion tokens (`fast 180 / base
   320 / slow 520`) already match in customer + rider — extend the same
   `motion.dart` to vendor & host. Low-risk, additive; safe to do incrementally.

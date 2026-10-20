# The Kada — build, release and repo-sync runbook

Last verified: 2026-09-22. No secrets belong in this file.

## 1. Repositories

| Project | Path | Remote | Notes |
|---|---|---|---|
| Kada monorepo | `The Kada/` | `github.com/amal-chd/resturantos` (private) | 4 Flutter apps + admin web (`src/`) + `functions/` + `customer_web/` |
| Marketing site | `The Kada/thekada_web/` | `github.com/amal-chd/thekada` (public) | Separate repo, own history |
| KadaStay (legacy) | `The Kada/KadaStay/` | **none** | No git remote. Last commit 2026-06-24. Its app/website were folded into the monorepo (`host_app/`). Exists on this Mac only. |

Apps in the monorepo:

| App | Directory | Bundle ID | Store name |
|---|---|---|---|
| Customer | `customer_mobile_app/` | `com.thekada.app` | The Kada |
| Vendor | `vendor_mobile_app/` | `com.kadadine.app` | Kada Dine |
| Delivery / rider | `delivery_mobile_app/` | `com.thekada.kadaRider` | — |
| Host (stay) | `host_app/` | `com.kadastay.app` | — |

## 2. Toolchain (verified working on this Mac)

Flutter 3.44.8 · Dart 3.12.2 · Xcode 27.0 (27A266a) · CocoaPods 1.17.0 · Node v24.18.1 · iOS deployment target 15.0 · signing: Automatic, team `BHVUW7B4ZB`.

## 3. iOS: the UIScene requirement (do not regress this)

iOS 27 **terminates at launch** any app built with the iOS 27 SDK that has not adopted the UIScene lifecycle (`EXC_BREAKPOINT` in `_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`). Every app here must keep:

1. `UIApplicationSceneManifest` in `ios/Runner/Info.plist` with
   `UISceneDelegateClassName = $(PRODUCT_MODULE_NAME).SceneDelegate`.
2. `AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate`, registering plugins **only** inside `didInitializeImplicitFlutterEngine`. Registering in `didFinishLaunchingWithOptions` leaves every plugin unregistered, because the implicit engine is created when the scene connects.
3. No use of `window?.rootViewController` at launch — it is nil under scenes.
4. The `SceneDelegate` subclass that forwards `scene:openURLContexts:` to the app-delegate chain, so `firebase_auth`'s reCAPTCHA/OAuth redirects still arrive.

Local simulators here only have the **iOS 26.5** runtime, where this is a warning rather than fatal. Final proof of the fix requires an iOS 27 simulator runtime, an iOS 27 device, or TestFlight.

**`UISceneDelegateClassName` must name the class you actually define.** If the plist says `FlutterSceneDelegate` while `AppDelegate.swift` defines a `SceneDelegate` subclass, iOS instantiates Flutter's base class and the subclass never runs — the app launches fine and the URL forwarding is silently gone, surfacing later as "OTP / Google sign-in stopped working". A merge produced exactly this once. Check the pair after any merge that touches `ios/Runner`:

```bash
for a in customer_mobile_app vendor_mobile_app delivery_mobile_app host_app; do
  python3 -c "
import plistlib;d=plistlib.load(open('$a/ios/Runner/Info.plist','rb'))
print('$a', d['UIApplicationSceneManifest']['UISceneConfigurations']['UIWindowSceneSessionRoleApplication'][0]['UISceneDelegateClassName'])"
  grep -c 'class SceneDelegate' $a/ios/Runner/AppDelegate.swift
done
```

## 4. Xcode Cloud

`ci_scripts/ci_post_clone.sh` exists at the repo root and per app (`<app>/ios/ci_scripts/`). Xcode Cloud runs the script next to the project it builds.

**The script must be mode `100755` in git or Xcode Cloud silently skips it**, Flutter never runs, `Generated.xcconfig` is missing, and the build fails with `module 'cloud_firestore' not found`.

This repo has `core.fileMode = false`, so `chmod +x` on disk does **not** reach git. Use:

```bash
git update-index --chmod=+x <app>/ios/ci_scripts/ci_post_clone.sh
```

Verify before pushing:

```bash
git ls-files -s | grep ci_post_clone
```

Point the Xcode Cloud workflow at `ios/Runner.xcworkspace` (never `Runner.xcodeproj` — the Pods are not in the project).

Vendor builds read `GEMINI_API_KEY` from the workflow environment and pass it as `--dart-define`. Without it the app still builds; AI menu import reports itself unconfigured.

## 4b. Push notifications and signing identity

Release builds use `ios/Runner/RunnerRelease.entitlements` (`aps-environment = production`); Debug and Profile keep `Runner.entitlements` (`development`). A build that ships to TestFlight with the development entitlement registers against the APNs **sandbox**, so production pushes never arrive — that was true of the Kada Dine archive built 2026-09-21. Check any archive before uploading:

```bash
codesign -d --entitlements - --xml <Runner.app> | plutil -convert xml1 -o - - | grep -A1 aps-environment
```

Caveat: all four projects still hardcode `CODE_SIGN_IDENTITY[sdk=iphoneos*] = "iPhone Developer"` in **every** configuration, including Release. Archiving locally with automatic signing therefore picks a development profile and rewrites `aps-environment` back to `development`, whatever the entitlements file says. Codemagic and Xcode Cloud override the identity with the App Store profile they fetch, so the production entitlement applies there. If you archive from Xcode by hand, fix the identity first or the upload will have sandbox push.

`delivery_mobile_app` and `host_app` have **no entitlements file at all** while depending on `firebase_messaging`, so they cannot register for remote notifications; the rider app also omits the `remote-notification` background mode. Adding those requires the App IDs to carry the push capability — do it in the developer portal first, or signing will fail.

## 4c. Google Maps keys

Two keys, because the two kinds of Google API protect themselves differently:

| Key | Used by | Restrict it to | Ships in the app? |
|---|---|---|---|
| **Maps SDK key** | the map view (`GMSServices.provideAPIKey`, Android manifest) | the four iOS bundle ids and the Android package + signing SHA-1; APIs: Maps SDK for iOS, Maps SDK for Android | yes — unavoidable, restrictions are what protect it |
| **Server key** | `geoLookup` Cloud Function (Places, Geocoding, Directions) | nothing needs to ship it; keep it a Functions secret | **no** |

Places, Geocoding and Directions are *web-service* APIs. They **ignore** iOS/Android application restrictions and honour only IP restrictions, which a phone cannot satisfy — so a key shipped for them can be extracted from the binary and spent against the project. That is why those calls go through `geoLookup` instead.

**Never ship an unrestricted key.**

Set the server key once:

```bash
firebase functions:secrets:set GOOGLE_MAPS_SERVER_KEY
```

The Maps SDK key is no longer in source. Supply it per machine and per CI run:

- **Locally (iOS)**: copy `<app>/ios/Flutter/Secrets.xcconfig.example` to `Secrets.xcconfig` (gitignored) and set `GOOGLE_MAPS_API_KEY`.
- **Locally (Android)**: add `GOOGLE_MAPS_API_KEY=...` to `android/local.properties`, or pass `-PGOOGLE_MAPS_API_KEY=...`.
- **Xcode Cloud / Codemagic**: set `GOOGLE_MAPS_API_KEY` as a secret environment variable. `ci_post_clone.sh` writes the xcconfig from it; Gradle reads it from the environment.

An unset key still builds and runs — only the map fails to render, and the app logs `GOOGLE_MAPS_API_KEY is not set`.

The `AIzaSy…` values in `firebase_options.dart` and `src/lib/firebase.ts` are **Firebase client config**, not secrets: they identify the project and are protected by Firestore rules and App Check. Leave them.

## 5. Codemagic

`codemagic.yaml` defines `customer-app-release`, `vendor-app-release`, `delivery-app-release`, `host-app-release`. It publishes the **pubspec version as-is**, so bump `version: x.y.z+build` before a release or App Store Connect rejects the duplicate build number.

## 6. Release build checklist

```bash
cd <app>
flutter pub get
flutter analyze                 # must report 0 errors
flutter test                    # where tests exist
flutter build ios --release     # add --dart-define=GEMINI_API_KEY=... for vendor
```

Then, before uploading:

- Launch the build, force-quit, relaunch, background/foreground.
- Confirm sign-in, home, and one core flow load real data.
- Confirm the build number is higher than anything already on TestFlight.
- Do **not** upload if the app crashes at launch on an iOS 27 device.

## 6b. Self-healing: what guards what

Three layers, each built from a failure that actually reached production. None
of them is decorative — every check was verified to fail when its defect is
reintroduced.

**Before a commit or deploy — `npm run doctor`**

`scripts/doctor.mjs` fails the build on: region drift (client code pointing at a
region the functions no longer run in), `ci_post_clone.sh` not being `100755` in
git, a missing UIScene manifest or a scene-delegate class the plist never
instantiates, plugins registered outside `didInitializeImplicitFlutterEngine`,
live credentials or hardcoded Maps keys in tracked source, config flags written
by the admin UI that nothing reads, an out-of-date Node runtime, iOS deployment
targets following Xcode's drifting recommendation, and broken Maps key wiring.

It runs as a `predeploy` hook on both hosting and functions, so a deploy cannot
carry these defects. During an incident, `KADA_SKIP_DOCTOR=1` bypasses it.

`npm run doctor:online` additionally compares deployed functions against source:
functions deployed in two regions (a scheduled copy in each region fires twice —
this is how every scheduled campaign was sent twice), functions outside
`asia-south1`, and stale runtimes.

**In CI — `.github/workflows/ci.yml`**

Runs the doctor, typechecks the admin app, builds functions, and — importantly —
runs `flutter analyze` and `flutter test` from a *clean clone*. Two apps once
failed to build for anyone but the author: the vendor app imported a gitignored
`lib/config/ai_config.dart`, and the rider app imported a `polyline_decoder.dart`
that had never been committed. Neither is visible on a machine that already has
the file.

**At runtime — the cron watchdog**

Scheduled jobs wrapped in `withCronHeartbeat` (`functions/src/cronHealth.ts`)
record every run in `cron_health/{name}`. `checkCronHealth` reports any cron
failing repeatedly or that has not succeeded within four of its own intervals,
and the result is folded into `ops_health/anomalies`, which the console's Ops
Alerts panel already renders.

This exists because a cron that throws looks exactly like a cron with nothing to
do. A set of missing composite indexes silently stopped scheduled orders,
notification retries and the stuck-order alert itself — for days.

Note on what is deliberately *not* checked: there is no static
"missing composite index" check. Firestore serves equality-only queries by
merging single-field indexes and treats `in` as a disjunction, so a static rule
produces false positives, and a false failure in a predeploy hook blocks
releases. The heartbeat catches the real thing within minutes of a deploy, with
Firestore's own error text attached.

## 7. Git sync

Before work: `git fetch --all --prune`, confirm branch, pull/rebase.
After work: `git status`, review the diff, commit, push, then re-verify `git status -sb` shows no divergence.

Never commit: `.env*`, service-account JSON, `.p12`/`.p8`, provisioning profiles, API secrets, `rzp-key.csv`.
`GoogleService-Info.plist` / `google-services.json` are client config and are intentionally tracked.

Preserving work safely (never `git stash pop` in a shared checkout — worktrees share one stash stack):

```bash
git stash push -u -m "<unique-tag>"     # if you must stash
git stash list --format='%H %gs'        # capture your entry's SHA
git stash apply <sha>                   # apply, never pop
```

To snapshot a working tree onto a branch without touching it, build the commit with a temporary index (`GIT_INDEX_FILE=... git read-tree HEAD && git add -A && git write-tree && git commit-tree`).

## 8. Troubleshooting

| Symptom | Cause |
|---|---|
| App dies instantly on iOS 27, no Dart logs | UIScene not adopted (§3) |
| `module 'cloud_firestore' not found` in Xcode Cloud | `ci_post_clone.sh` not mode 100755, or workflow points at `.xcodeproj` |
| `MissingPluginException` after scene migration | Plugins registered in `didFinishLaunchingWithOptions` instead of `didInitializeImplicitFlutterEngine` |
| `Undefined name 'AiConfig'` (vendor) | Build without `--dart-define=GEMINI_API_KEY`; the old gitignored `ai_config.dart` is no longer used |
| `pod install` fails with `curl: (16) HTTP2 framing layer` | Transient network; re-run |
| App builds locally but not from a clean clone | A referenced file is gitignored or was never committed — check `flutter analyze` on a fresh clone |

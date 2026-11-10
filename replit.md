# Pressure Washing Calculator+

An iPhone app (Expo), shown as "Wash Quote+" on the home screen, for solo pressure-washing operators: price a whole visit (driveways, walkways, patios, stairs, other flatwork) from a few taps or a pasted customer message, check whether it is worth the time, and send a clean quote.

## Run & Operate

- Workflow `artifacts/pressure-quote: expo` runs Metro (Expo Go via QR, plus web preview). Restart it only after dependency changes.
- `pnpm --filter @workspace/pressure-quote run typecheck` — TypeScript check for the app
- `pnpm --filter @workspace/pressure-quote run test:code` — fixture, message-corpus, storage and feature tests (`tests/fixtures.ts`, `tests/messages.ts`, `tests/storage.ts`, `tests/features.ts`). `tests/messages.ts` is a corpus of real-style customer and operator texts; add a case whenever a message is misread
- `pnpm --filter @workspace/pressure-quote run test` — the same plus the release gate (`tests/release.ts`), which fails if the privacy, terms or support URLs in `constants/legal.ts` are placeholders
- `CI=1 pnpm exec expo install --check` (from the app folder) — keep native packages aligned with the Expo SDK
- Privacy, terms and support pages: the text lives in `constants/legal.ts` (shown in the app); `pnpm --filter @workspace/pressure-quote run legal:pages` regenerates `server/pages/*.html`, served at https://wash-wizard.replit.app/privacy, /terms and /support. `test:code` fails if the pages drift from the app text. Republish after changing them, and keep the site published: the App Store listing links to these pages.
- `pnpm --filter @workspace/pressure-quote run check:live` — after publishing, confirms the hosted privacy, terms and support pages match the app text and the telemetry endpoint is live
- App Store Connect copy (subtitle, keywords, description, review notes, App Privacy answers): `artifacts/pressure-quote/docs/app-store-listing.md`
- RevenueCat seed script lives in `scripts/src/seedRevenueCat.ts` (entitlement `pro`, offering `default`, packages `$rc_monthly` / `$rc_annual`)
- The API server receives only the app's anonymous telemetry (`POST /api/telemetry/events` and `/crashes`, table `telemetry`); the mockup sandbox is a scaffold leftover. The Expo artifact's production server (`server/serve.js`) serves only the public site: `/`, `/privacy`, `/terms`, `/support` and `/status` (no Expo Go manifests or bundles; the App Store build comes from the Launch flow). `scripts/build.js` is unused.
- Part C plan (what a $30/month version would need: cloud backup, accept link, invoices, auto follow-ups): `artifacts/pressure-quote/docs/pricing-30-plan.md`

## Stack

- Expo SDK 58, expo-router (typed routes), React Compiler on, static `app.json` only
- Storage: AsyncStorage on device; no accounts, no server
- Purchases: `react-native-purchases` (RevenueCat). Expo Go and web run in Preview / Test Store mode; real purchases need a native build
- PDF: expo-print + expo-sharing; backup via expo-file-system + expo-document-picker
- Fonts: Inter (body), Barlow Semi Condensed (display); icons: Feather + MaterialCommunityIcons for services

## Where things live

- `artifacts/pressure-quote/lib/pricing.ts` — quote math in integer cents (minimum, trip, discount, tax, deposit)
- `lib/decimal.ts` — exact decimal parsing; `lib/geometry.ts` — shapes and cut-outs
- `lib/parser.ts` + `lib/resolve.ts` — on-device customer-message parser and question resolution
- `lib/document.ts` / `lib/output.ts` — frozen quote document, HTML/PDF and plain-text output
- `lib/access.ts` — free-quote / Pro / revision access policy; `lib/revenuecat.tsx` — subscription provider
- `lib/store.tsx` + `lib/storage.ts` — persisted jobs, settings, meta and the free-quote ledger
- `lib/lineEdit.ts` — unit and pricing-basis switches with exact undo, flat price, pasted "24x36"
- `lib/onboarding.ts` — first-run setup answers; `lib/economics.ts` — worth-it check, rate from time; `lib/recap.ts` — estimated vs actual; `lib/reminders.ts` — backup card timing
- `constants/colors.ts` — all color tokens (including the fixed `paper` palette for the quote document); `constants/legal.ts` — app name, support email, terms and privacy text
- Requirements: `attached_assets/pressure-washing-app-foundation_1794286206686.md`

## Architecture decisions

- Frontend-only by design: data stays on the iPhone; backup is an exported file.
- Blank never means zero. Every money/size input carries an explicit state (unknown, known zero, known value).
- A created quote is a frozen revision document; later rate, tax or branding changes never alter it.
- The free-quote ledger is separate from user data: backup import never restores usage or entitlement, and "Delete all data" keeps the ledger.
- A customer's budget from a message is recorded privately and never used as a price.

## Product

- First run: a 4-step setup (services, rates or flat prices, minimum + sales tax + hourly target, business name), each skippable, with a live example quote. Installs from before it existed skip it.
- Built-in services: driveway, walkway, patio, stairs, house wash, roof, deck (area) and fence, gutters (length); every one can also be a flat price, and none has a suggested rate. The services picked in setup (or Settings > Rates) lead on Home and on jobs; the rest sit under "More". Old installs keep the original four.
- "Try it with an example message" on Home opens a complete, editable SAMPLE job with made-up rates that are never saved.
- Quick start: tap services on Home, then sizes and rates price the quote live. A missing rate offers "Work out my rate" (from the operator's own time and hourly figure) or "I already know the price".
- Paste a customer's message: services, sizes (including "40 ft long and 4 ft wide"), name, phone and address are picked out; unclear items become questions (a loose area with a house wash or roof is always asked about, never assigned); "two walkways, one 3x30 and one 4x25" makes Walkway 2; customer sizes stay dashed amber until confirmed ("Looks right").
- Worth-it check (private): pay per hour for the whole visit against a target; one-tap visit time chips on the job.
- After the job: a recap compares estimated and actual on the same basis (before or after costs). "Quote similar work" on recent jobs copies services and rates with sizes cleared; earlier customers are suggested as a name is typed, with "Start from their last quote".
- Sending: "Text to {first name}" opens Messages with the PDF ("{Business} Quote Q-0007.pdf") when the customer has a mobile number (iPhone only); the text closes with the first line of the operator's customer note. If Messages reports sent, the job is marked Sent; otherwise the app asks. Share PDF, Copy and Print otherwise.
- Sales tax not yet answered: quotes say "Plus any applicable sales tax" under the total.
- Usual sizes: "2 car driveway" asks once for the operator's usual 2-car size, then offers it in one tap (Settings > Rates > Your usual sizes). No size ships with the app.
- A blank job opened from Home and left untouched is discarded and its quote number reused.
- Tools tab: area calculator (shapes and cut-outs, can start a quote), price check, margin and markup.
- 3 free quotes; drafts, corrections and re-sharing are free. Pro is unlimited ($9.99/month or $59.99/year, no free trial).
- Rating prompt (native only): when a quote is marked Accepted or a job's first recap is saved, after 3 such moments, at most every 120 days. Never after sharing, on paywalls or the last free quote.
- Deliberately not shipped (no buttons shown): remote AI parsing, remote measurement, chemical tools, reminders.

## User preferences

- Premium feel, "like a magic wand": first result from minimal input, no stock emojis anywhere.
- Owner: Kaden Coziar, Kozi Publishing LLC. Support email: support@kozipublishing.com.
- Bundle ID: `com.kozipublishing.pressurequote`.

## Gotchas

- Never add `app.config.ts`/`.js`, run `expo start` by hand, or run EAS commands.
- Typed routes: use the object form `router.push({ pathname: '/job/[id]', params: { id } })`.
- No hardcoded hex colors outside `constants/colors.ts`.
- Tests run with `tsx` and a local assert helper (no `@types/node` in this package), so `lib/` logic must not import React Native.
- Number fields: a typed comma is a decimal point; a pasted "1,400" is 1400; minus signs and ambiguous text are rejected, never rewritten.
- Analytics and crash reporting: `lib/analytics.ts` sinks, connected in release builds only by `lib/telemetry.ts` to the API server. Only fixed event names, paywall source, app area and error class name are sent; changing that means updating the privacy policy, `legal:pages` and the App Privacy answers. The app name still needs clearance before submission.
- Test Store purchases use the in-app confirm sheet, never `Alert`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details

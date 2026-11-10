# Pressure Washing Calculator+

An iPhone app (Expo) for solo pressure-washing operators: price a whole visit (driveways, walkways, patios, stairs, other flatwork) from a few taps or a pasted customer message, check whether it is worth the time, and send a clean quote. Name is provisional.

## Run & Operate

- Workflow `artifacts/pressure-quote: expo` runs Metro (Expo Go via QR, plus web preview). Restart it only after dependency changes.
- `pnpm --filter @workspace/pressure-quote run typecheck` — TypeScript check for the app
- `pnpm --filter @workspace/pressure-quote run test` — money, parser, access and output fixture tests (`tests/fixtures.ts`)
- `CI=1 pnpm exec expo install --check` (from the app folder) — keep native packages aligned with the Expo SDK
- RevenueCat seed script lives in `scripts/src/seedRevenueCat.ts` (entitlement `pro`, offering `default`, packages `$rc_monthly` / `$rc_annual`)
- The API server and mockup sandbox artifacts are scaffold leftovers; the app does not call a backend.

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
- `constants/colors.ts` — all color tokens (including the fixed `paper` palette for the quote document); `constants/legal.ts` — app name, support email, terms and privacy text
- Requirements: `attached_assets/pressure-washing-app-foundation_1794286206686.md`

## Architecture decisions

- Frontend-only by design: data stays on the iPhone; backup is an exported file.
- Blank never means zero. Every money/size input carries an explicit state (unknown, known zero, known value).
- A created quote is a frozen revision document; later rate, tax or branding changes never alter it.
- The free-quote ledger is separate from user data: backup import never restores usage or entitlement, and "Delete all data" keeps the ledger.
- A customer's budget from a message is recorded privately and never used as a price.

## Product

- Quick start: tap services on Home, then sizes and rates price the quote live.
- Paste a customer's message: services, sizes (including "40 ft long and 4 ft wide"), name, phone and address are picked out; unclear items become questions; customer sizes stay dashed amber until confirmed ("Looks right").
- Worth-it check (private): pay per hour for the whole visit against a target.
- Tools tab: area calculator (shapes and cut-outs, can start a quote), price check, margin and markup.
- 3 free quotes; drafts, corrections and re-sharing are free. Pro is unlimited (monthly / yearly).
- Deliberately not shipped (no buttons shown): remote AI parsing, remote measurement, chemical tools, reminders.

## User preferences

- Premium feel, "like a magic wand": first result from minimal input, no stock emojis anywhere.
- Owner: Kaden Coziar, Kozi Publishing LLC. Support email: support@kozipublishing.com.
- Bundle ID: `com.kozipublishing.pressurequote`.

## Gotchas

- Never add `app.config.ts`/`.js`, run `expo start` by hand, or run EAS commands.
- Typed routes: use the object form `router.push({ pathname: '/job/[id]', params: { id } })`.
- No hardcoded hex colors outside `constants/colors.ts`.
- Tests run with `tsx` and a local assert helper (no `@types/node` in this package).
- Test Store purchases use the in-app confirm sheet, never `Alert`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details

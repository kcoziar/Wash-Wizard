---
name: Telemetry and rating prompt rules
description: What the app may send to its own server, and when the App Store rating prompt may appear.
---

- Telemetry is first-party (API server, Postgres table `telemetry`), release builds only. Payloads are strict enums plus the error class name; never messages, stacks, IDs or IP addresses. Server bodies use `.strict()` zod so extra fields are refused.
- Any change to what is sent must also change PRIVACY in constants/legal.ts, regenerate legal pages, and the App Privacy table in docs/app-store-listing.md (Usage Data > Product Interaction and Diagnostics > Crash Data, not linked, not tracking; RevenueCat adds Purchase History).
- Rating prompt: only on a success moment (quote marked Accepted, first recap saved), meaningfulActions >= 3, 120-day cooldown, native API. Never after sharing, on paywalls, the last-free-quote transition or error recovery.

**Why:** owner reconciled Claude/ChatGPT release advice into these rules on 2026-11-10; App Privacy answers depend on them staying true.
**How to apply:** check before adding any event, crash field, network call or review trigger.

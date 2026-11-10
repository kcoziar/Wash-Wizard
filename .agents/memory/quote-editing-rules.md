---
name: Quote editing rules
description: Non-obvious product rules for sizes, rates, unit/basis switches, copies and suggestions that later edits must keep.
---

- `lib/pricing.ts` and `lib/decimal.ts` are frozen behind the USD_V1 fixtures; build new behaviour around them (lineEdit, economics, format) instead of editing them.
- Pasted text is always customer mode (sizes need "Looks right"); only operator mode treats sizes and "250 flat" as the operator's own.
- Switching units converts size and rate with extra precision so the price holds; switching back restores the exact typed values only if nothing was edited in between. Changing pricing basis never carries a size or rate across; it starts blank or from the saved rate for that basis.
- Undo snapshots (`unitOrigin`, `basisOrigin`) are session-only: storage drops them and copies strip them, so a copy never restores another visit's sizes.
- "Work out my rate" is a cost-covering figure from the operator's own time and hourly target (plus known per-hour costs), rounded up. Never present it or anything else as a market rate.
- Earlier-customer suggestions show only while address and phone are empty, so they never nag once details are in.

**Why:** these came from the production review and the owner's "never invent numbers / blank is never zero" stance; each was a reported bug or a deliberate trade-off.
**How to apply:** check here before changing line editing, copies, setup or rate helpers.

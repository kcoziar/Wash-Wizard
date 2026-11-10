---
name: Quote editing rules
description: Non-obvious product rules for sizes, rates, unit/basis switches, copies and suggestions that later edits must keep.
---

- `lib/pricing.ts` and `lib/decimal.ts` are frozen behind the USD_V1 fixtures; build new behaviour around them (lineEdit, economics, format) instead of editing them.
- Pasted text is always customer mode (sizes need "Looks right"); only operator mode treats sizes and "250 flat" as the operator's own.
- Switching units converts size and rate with extra precision so the price holds; switching back restores the exact typed values only if nothing was edited in between. Changing pricing basis never carries a size or rate across; it starts blank or from the saved rate for that basis.
- Undo snapshots (`unitOrigin`, `basisOrigin`) are session-only: storage drops them and copies strip them, so a copy never restores another visit's sizes.
- "Work out my rate" is a cost-covering figure from the operator's own time and hourly target (plus known per-hour costs), rounded up. Never present it or anything else as a market rate.
- New built-in services (house wash, roof, deck, fence, gutters) never get a suggested rate. A loose area in a message with a house wash or roof is asked about ("What does 2,400 sq ft describe?"), never attached to one or split across both: home size, siding and roof area are different numbers.
- Parser text is normalised before matching ("one" arrives as "1"), so enumerator regexes must accept digits.
- Sample/example jobs never offer "save as my rate" and never count toward free quotes, past customers or time suggestions.
- Earlier-customer suggestions show only while address and phone are empty, so they never nag once details are in.
- Usual sizes (e.g. 2-car driveway) come only from the operator's own first answer; it is never overwritten by a later per-job size and only offered when the line's unit matches.
- "Same customer, just a correction" is offered once per job; a new visit is detected by name or phone change.
- The customer PDF keeps saying "Job minimum adjustment" even though operator toggles were reworded; that customer wording is intentional.
- Issue lists group per line ("Driveway: add a size and your rate"); a qty item is dropped when a size question is already open. Grouping lives in resolve.ts because pricing.ts is frozen.

**Why:** these came from the production review and the owner's "never invent numbers / blank is never zero" stance; each was a reported bug or a deliberate trade-off.
**How to apply:** check here before changing line editing, copies, setup or rate helpers.

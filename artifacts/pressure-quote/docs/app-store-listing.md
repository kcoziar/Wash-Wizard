# App Store listing: Pressure Washing Calculator+

Copy for App Store Connect. Every claim here matches what the app does in this build.

## Basics

| Field | Value |
| --- | --- |
| Name (30 max) | Pressure Washing Calculator+ |
| Subtitle (30 max) | Quotes from customer texts |
| Bundle ID | com.kozipublishing.pressurequote |
| Primary category | Business |
| Secondary category | Productivity |
| Age rating | 4+ (no objectionable content) |
| Price | Free with in-app purchases |
| Privacy Policy URL | https://wash-wizard.replit.app/privacy |
| Terms of Use (EULA) | Apple Standard EULA, plus https://wash-wizard.replit.app/terms in the description |
| Support URL | https://wash-wizard.replit.app/support |
| Copyright | 2026 Kozi Publishing LLC |

## Keywords (100 characters max, comma separated, no spaces)

```
power washing,estimate,soft wash,driveway,house wash,roof,deck,fence,gutter,square foot,pricing
```

(95 characters. Do not repeat words already in the name or subtitle; Apple indexes those separately.)

## Promotional text (170 max)

```
Paste a customer's text and get a priced quote in seconds: driveways, walkways, patios, steps, house washes, roofs, decks, fences and gutters. 3 free quotes, then Pro.
```

## Description

```
Turn a customer's message into a clear, professional pressure washing quote.

Paste the text a customer sent you. The app picks out the services, sizes, name, address and budget, and asks you about anything it can't be sure of. It never guesses a size or turns a budget into a price.

PRICE YOUR WAY
- Your own rates per square foot, per linear foot, per step or a flat price
- Driveways, walkways, patios, steps, house washes, roofs, decks, fences and gutters, plus anything else you add
- Measure tool for odd shapes (rectangles and triangles), in feet or meters
- Minimum charge, trip fee, discount, tax and deposit

KNOW IF THE JOB IS WORTH IT
- See what a visit pays per hour after your costs, privately
- Never shown to the customer

SEND IT
- Share a clean PDF quote or text it straight from Messages
- Corrections and re-sending are always free
- Mark quotes Sent, Accepted or Declined and keep a record of every version

YOUR DATA STAYS WITH YOU
- No account. Jobs and customer details stay on your iPhone
- Back up and restore whenever you like

Try it with the built-in example message before quoting your own job.

PRO
3 free quotes, then Pro for unlimited quotes: $9.99 per month or $59.99 per year. No free trial. Payment is charged to your Apple ID at confirmation of purchase. Subscriptions renew automatically unless cancelled at least 24 hours before the end of the current period, and your account is charged for renewal within 24 hours before the end of the period. Manage or cancel in your App Store account settings.

Terms of Use: https://wash-wizard.replit.app/terms
Privacy Policy: https://wash-wizard.replit.app/privacy
```

## In-app purchases

| Product ID | Type | Price | Display name |
| --- | --- | --- | --- |
| pwc_pro_monthly | Auto-renewable, 1 month | $9.99 | Pro Monthly |
| pwc_pro_annual | Auto-renewable, 1 year | $59.99 | Pro Annual |

Both in one subscription group. Do not add an introductory offer or free trial: the app's paywall would show one if App Store Connect offered it, and the listing says there is none.

Each product needs a review screenshot of the paywall and a short description such as "Unlimited quotes".

## App Review notes

```
No account or login is needed.

To see the main flow quickly:
1. On first launch, tap "Skip setup" (or answer the short setup).
2. On Home, tap "Try it with an example message". This opens a complete sample quote built from a made-up customer message. Sample quotes never use a free quote.
3. Tap "Review & create quote" to see the customer document, then create and share it.

Free use: 3 quotes. The 4th new quote opens the paywall (Pro Monthly $9.99 or Pro Annual $59.99, no trial). Corrections to an existing quote, re-sharing and sample quotes are always free. Restore is on the paywall and in Settings > Help.

Settings > Legal opens the Privacy Policy and Terms of Use (which link to Apple's Standard EULA). Settings > Backup & data > Delete all data removes everything stored by the app.

The app reads the clipboard only when the user taps Paste. It does not request photo library, camera, contacts or location permission; the logo uses the system photo picker.

The app sends anonymous event names (for example "quote created") and crash types to our own server, with no identifiers and no customer content. There is no third-party analytics or advertising SDK. Subscriptions are checked through RevenueCat with an anonymous ID.
```

## App Privacy answers

"Do you or your third-party partners collect data from this app?" **Yes.**

| Data type | Collected by | Purposes | Linked to user? | Used for tracking? |
| --- | --- | --- | --- | --- |
| Purchases > Purchase History | RevenueCat | App Functionality, Analytics | No (anonymous RevenueCat ID, no login) | No |
| Usage Data > Product Interaction | Our server | Analytics | No | No |
| Diagnostics > Crash Data | Our server | App Functionality | No | No |

Everything else: **Not collected**. That includes Contact Info, Location, Contacts, User Content, Identifiers, Financial Info, Health, Browsing and Search History, Sensitive Info, and Other Data. Customer names, addresses, phone numbers and quotes stay on the device and are never sent to us or to RevenueCat. RevenueCat's own guidance (revenuecat.com/docs, "Apple App Privacy") requires Purchase History with App Functionality and Analytics; it adds User ID only for custom app user IDs, which this app does not set.

What "our server" receives, for reference: an event name from a fixed list (setup finished/skipped, quotes 1 to 3 created, Paste used, Text used, paywall viewed and from where, purchase, restore), or for a failure the app area (render, PDF, share, storage, purchase) and the error class name such as "TypeError". Plus the app version and "ios". No message text, stack, device ID, IP address or customer data. Development builds send nothing.

## Before submitting

1. Publish the project so the privacy, terms and support pages and the telemetry endpoint are live, then run `pnpm --filter @workspace/pressure-quote run check:live`.
2. Set the governing-law state in the Terms if your lawyer wants one.
3. Screenshots: 6.9" and 6.5" iPhone sizes, taken on a device or the simulator.

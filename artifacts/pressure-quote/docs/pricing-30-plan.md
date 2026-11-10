# What a $30/month Pressure Washing Calculator+ would need

Status: plan only. Nothing here is built. Costs are rough estimates from typical published rates; check current pricing before deciding. Today's price stays $9.99/month and $59.99/year, with no trial.

## Why the current app is not a $30 product

The app is fast and accurate at one job: turning a customer's text into a priced, professional quote on the phone. Everything stays on the iPhone, with no account and no server holding customer data. That makes it a strong $10 tool. Operators who pay $30 or more for field-service apps such as Jobber or Housecall Pro (entry plans commonly in the $30–$80 a month range; check current pricing) are paying for what happens *after* the quote. That means the customer accepts it, the job is booked, the invoice is paid, and nothing is lost when a phone breaks. Each of those needs a server and an account, which changes the privacy promise in the App Store listing ("Data Not Collected" for customer details).

Recommended order if you go ahead: C1, then C2, then C3, then C4. C1 adds the account that the other three depend on.

---

## C1. Automatic cloud backup and restore on a new phone

**What it does:** every job, quote, setting and logo syncs to the operator's account. A new phone signs in and everything is back. Today this needs a manual backup file.

**Needs**
- Sign-in: Sign in with Apple (required by Apple if any other sign-in is offered), plus email as a fallback.
- A server and database: one table of encrypted job records per account, plus object storage for logos and PDFs.
- Sync logic: last-writer-wins per job with the existing revision history merged, never overwritten. Quotes are immutable already, which makes this simpler.
- The free-quote count and Pro entitlement move to the account (RevenueCat app user ID = account ID), so reinstalling no longer resets anything.

**Privacy change:** customer names, phones, addresses and prices leave the phone. The App Privacy label changes from "Data Not Collected" to "Data Linked to You" (Contact Info, User Content). The privacy policy needs a data-retention and deletion section, and in-app account deletion is required by Apple.

**Rough size:** 3–4 weeks.

**Running cost:** about $10–25/month for a small server and database until a few thousand users, then roughly $0.01–0.03 per active user per month. Storage is small (a job is a few KB and a logo is stored once).

---

## C2. A quote link the customer opens and accepts in one tap

**What it does:** instead of only a PDF, the text contains a link such as `quotes.yourapp.com/q/8fK2...`. The customer sees the quote in a browser and taps **Accept** (optionally picking a day). The operator sees "Viewed 2:14 pm" and "Accepted" on the job, and gets a push notification.

**Needs**
- C1's account and server (the quote must live somewhere the customer can reach).
- A public web page per quote, with an unguessable link that expires and that the operator can revoke.
- Push notifications (APNs) for "viewed" and "accepted".
- Abuse protection: rate limiting, and no indexing by search engines.

**Privacy change:** the customer's name, address and quote are on a server and visible to anyone holding the link. The customer's own visit (time viewed, browser) is recorded. Both must be disclosed. Treat the customer as a data subject (they can ask for deletion).

**Rough size:** 2–3 weeks on top of C1.

**Running cost:** small. Page views are cheap, so allow about $5–10/month more. Push notifications are free through Apple.

**Why it matters for price:** this is the feature operators feel. "Viewed" status tells them when to follow up, and one-tap accept removes the back-and-forth texting.

---

## C3. Quote to invoice, with a deposit or payment link

**What it does:** an accepted quote becomes an invoice in one tap. A Stripe (or Square) payment link goes in the text, and the deposit already shown on quotes can be collected up front. Paid status updates on its own.

**Needs**
- C1 (account) and ideally C2 (customer page to pay from).
- Stripe Connect (Express accounts) so money goes straight to the operator's bank. You never hold funds. Onboarding is Stripe's hosted flow (identity, bank account).
- Webhooks on the server for paid, failed and refunded payments.
- Invoice numbering, a "paid" receipt PDF, and simple refunds.
- Apple rule check: payments for real-world services are allowed outside in-app purchase, so this does not owe Apple 15–30%.

**Privacy change:** payment status and amounts are stored. Card details stay with Stripe and never touch your server. Add Stripe as a processor in the privacy policy.

**Rough size:** 3–4 weeks.

**Running cost:** Stripe charges the operator 2.9% + 30¢ per card payment. You can add your own platform fee (for example 0.5–1%) through Connect, which could cover the server costs of C1–C4 on its own. There is no fixed monthly cost beyond the server.

---

## C4. Automatic follow-up texts on unanswered quotes

**What it does:** if a quote is not accepted after, say, 2 days, the customer gets a polite follow-up ("Just checking in on your driveway quote...") from the operator's business. The operator sets the timing once and can turn it off per job.

**Needs**
- C1 and C2 (the server needs to know the quote is still open, and the link to resend).
- An SMS provider (Twilio or similar) with a business phone number per operator, or one shared number with the business name in the text.
- US carrier registration (A2P 10DLC) is mandatory for business texting. It takes days to weeks and costs about $4–15 per brand to register, plus a monthly campaign fee (around $2–10).
- Opt-out handling ("Reply STOP"), quiet hours, and a per-customer cap. TCPA rules apply: the customer must have asked for the quote, which they did, but keep a record of it.
- A simpler first step that needs none of this: a local reminder to the *operator* ("Dana hasn't replied — send a follow-up?") that opens Messages with the text ready. That is the B3 item from the audit. It costs nothing to run and keeps the privacy promise.

**Privacy change:** customer phone numbers are sent to the SMS provider, and message logs are kept. This needs disclosure and STOP handling.

**Rough size:** 2 weeks after C1/C2, plus the carrier registration wait.

**Running cost:** about $0.008–0.012 per text segment plus about $1–2/month per phone number and the registration fees above. At 30 follow-ups a month per operator, roughly $1–3 per operator per month.

---

## Summary

| Item | Depends on | Rough size | Monthly running cost | Privacy label change |
|---|---|---|---|---|
| C1 Cloud backup | — | 3–4 weeks | $10–25 base, then about $0.02/user | Yes: becomes "Data Linked to You" |
| C2 Accept link + viewed | C1 | 2–3 weeks | +$5–10 | Yes: customer data on a public link |
| C3 Invoice + payments | C1 (C2 helps) | 3–4 weeks | Stripe fees paid by the operator | Small: add Stripe |
| C4 Auto follow-ups | C1, C2 | 2 weeks + registration | $1–3 per operator | Yes: SMS provider |

**Total:** about 10–13 weeks of work for all four. Server costs stay under about $50/month for the first few hundred paying operators. The real cost is support (payments and texting create support tickets) and keeping the privacy, payments and messaging compliance up to date.

**Honest pricing view:** with C1 and C2, $19–24/month is defensible. With all four, $29–39/month competes with the entry plans of the field-service apps above, while being faster to quote from a text. Without them, $30 will get refund requests and one-star "overpriced" reviews.

export const APP_NAME = 'Pressure Washing Calculator+';
export const COMPANY = 'Kozi Publishing LLC';
export const SUPPORT_EMAIL = 'support@kozipublishing.com';
export const APPLE_EULA_URL = 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';
export const MANAGE_SUBSCRIPTIONS_URL = 'https://apps.apple.com/account/subscriptions';
export const LEGAL_UPDATED = 'November 9, 2026';

export interface LegalSection {
  title: string;
  body: string;
}

export const PRIVACY: LegalSection[] = [
  {
    title: 'The short version',
    body: `${APP_NAME} keeps your jobs, customers, rates, costs and notes on this iPhone. There is no account, no advertising and no analytics tracking. We do not have a server that stores your quotes.`,
  },
  {
    title: 'What stays on your device',
    body: 'Quotes, customer names and addresses, request text you paste, rates, visit times, costs, private notes, completion recaps and your business details are stored locally by the app. Reading a pasted request happens on the device; the text is not sent anywhere.',
  },
  {
    title: 'Purchases',
    body: 'Subscriptions are processed by Apple. We use RevenueCat, a subscription service provider, to confirm whether your subscription is active. RevenueCat receives an anonymous app user ID, purchase and receipt details, and basic device and app information. No customer, job or pricing data is sent to RevenueCat.',
  },
  {
    title: 'Sharing quotes',
    body: 'When you share a quote, the iPhone share sheet sends it to the app and person you choose. The customer document contains only the scope, prices, tax, deposit, terms and the business details you entered. Your costs, time, margin, budget notes and private notes are never included.',
  },
  {
    title: 'Photos',
    body: 'If you add a logo, the system photo picker gives the app only the image you select. The app does not request access to your photo library, camera, contacts or location.',
  },
  {
    title: 'Backups you export',
    body: 'A backup file contains your jobs, customer details and private costs. You decide where it goes. The app does not encrypt backup files, so store them somewhere you trust.',
  },
  {
    title: 'Deleting your data',
    body: 'Settings \u203A Backup & data \u203A Delete all data removes your jobs, customers, rates, costs, notes and business details from this device. A small anonymous count of free quotes used is kept so that deleting data does not reset it; it contains no customer or job information. Deleting the app removes everything. Subscriptions are managed and cancelled in your Apple account settings.',
  },
  {
    title: 'Contact',
    body: `${COMPANY}. Questions or requests: ${SUPPORT_EMAIL}`,
  },
];

export const TERMS: LegalSection[] = [
  {
    title: 'License',
    body: `Your use of ${APP_NAME} is governed by Apple\u2019s Standard Licensed Application End User License Agreement, together with these terms. ${COMPANY} is the provider of the app.`,
  },
  {
    title: 'Your numbers, your decisions',
    body: 'Prices, totals, tax, deposits and earnings are calculated from the rates, quantities, times and costs you enter. The app does not know local market prices, tax rules or site conditions. You decide the scope and price of every quote you send. Earnings figures are estimates before income tax and are not accounting, tax, legal or financial advice.',
  },
  {
    title: 'Quotes are not contracts',
    body: 'Sharing a quote does not confirm delivery, acceptance or payment. Statuses such as Sent or Accepted are records you set yourself.',
  },
  {
    title: 'Free quotes and Pro',
    body: 'Three complete quotes are free. Creating a new quote uses one; drafts, corrections, revisions and re-sharing do not. Pro includes unlimited new quotes while it is active. Your saved quotes, exports, backups, revisions and completion recaps stay available if Pro ends.',
  },
  {
    title: 'Subscription terms',
    body: 'Payment is charged to your Apple ID when you confirm the purchase. Subscriptions renew automatically at the price shown unless cancelled at least 24 hours before the end of the current period. Your account is charged for renewal within 24 hours before the period ends. You can manage or cancel in your Apple account settings. Refunds are handled by Apple.',
  },
  {
    title: 'Your data',
    body: 'Your records are stored on this device. Restoring purchases recovers Pro access; it does not recover jobs. Export a backup to protect your records against device loss.',
  },
  {
    title: 'Contact',
    body: `${COMPANY}. ${SUPPORT_EMAIL}`,
  },
];

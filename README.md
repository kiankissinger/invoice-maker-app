# Invoice Maker

A mobile invoice and estimate app for iOS and Android, built with Expo and React Native. Freelancers and small businesses can create, send and track invoices from their phones. The app has a free tier. A Pro subscription with a free trial unlocks everything else.

> "Invoice Maker" is a placeholder name. To rename the app, change `APP_NAME` in `src/constants/theme.ts` and the `name`, `slug`, `scheme` and bundle IDs in `app.json`.

| Invoices | Editor | Paywall | Reports |
| --- | --- | --- | --- |
| ![](docs/screenshots/invoices.png) | ![](docs/screenshots/editor.png) | ![](docs/screenshots/paywall.png) | ![](docs/screenshots/reports.png) |

| PDF: Modern template | PDF: Bold template |
| --- | --- |
| ![](docs/screenshots/pdf-modern.png) | ![](docs/screenshots/pdf-bold.png) |

## Features

- **Invoices and estimates** with line items (quantity, rate, unit, details), a percent or fixed discount, tax on taxable items only, and shipping. A test suite covers the totals math.
- **Payment tracking.** You can record partial and full payments by method. Invoice status (draft, sent, partial, paid, overdue, void) is worked out from the payments and the due date, so it can't go stale.
- **Estimates:** mark them accepted or declined, capture the client's signature, and convert one to an invoice in one tap. The two documents link to each other.
- **PDF export and sharing** through the native share sheet (Mail, Messages, WhatsApp, Files and so on), plus print preview and AirPrint.
- **Four PDF templates** (Classic, Modern, Minimal, Bold) with your logo and brand color.
- **Clients** with contact details, billing history, and totals billed and outstanding.
- **Saved items and services** that you can add to any invoice with one tap.
- **Dashboard:** outstanding, overdue and paid-this-month totals, search, and status filters.
- **Reports:** invoiced versus collected over the last 6 months, unpaid invoices grouped by how late they are, top clients, and the value of open estimates.
- **Business profile:** logo, tax ID, payment instructions, 20 currencies, and document prefixes and numbering.
- Works offline and supports dark mode. Data stays on the device.

## Free vs Pro

| | Free | Pro |
| --- | --- | --- |
| Invoices and estimates | 3 total | Unlimited |
| PDF watermark | Yes | No |
| Templates | Classic | All 4 |
| Brand color | Default | Custom |
| Payments, clients, logo, PDF sharing | ✓ | ✓ |
| E-signatures | | ✓ |
| Estimate → invoice conversion | | ✓ |
| Saved items catalog | | ✓ |
| Duplicate documents | | ✓ |
| Reports | | ✓ |

The limits are defined in `src/lib/purchases.ts` (`FREE_DOCUMENT_LIMIT`, `PRO_FEATURES`). The checks are in `src/hooks/use-pro-gate.ts`. When a free user reaches a limit, the paywall opens and highlights the feature they tried to use.

## Tech stack

- Expo SDK 57, React Native 0.86, React 19, TypeScript (strict), React Compiler
- Expo Router for navigation, with file-based routes in `src/app/`
- Zustand, saved to AsyncStorage, for local data
- `expo-print` and `expo-sharing` for PDFs, and `react-native-svg` for signatures
- RevenueCat (`react-native-purchases`) for subscriptions and free trials on both stores

## Getting started

```bash
npm install
npm start          # then press i / a, or scan the QR code with a development build
npm run web        # quick UI check in the browser (no purchases or PDF sharing)
npm test           # unit tests for the money and date math
npm run typecheck
npm run lint
```

RevenueCat includes native code, so on a phone you need a development build instead of Expo Go:

```bash
npx eas-cli@latest build --profile development --platform ios   # or android
```

In development builds, **Settings → Developer → Simulate Pro** turns on every Pro screen without a store account.

## Setting up subscriptions and the free trial

1. **App Store Connect / Google Play Console:** create an auto-renewing subscription group with, for example, `pro_monthly` and `pro_annual`. Add a **free trial introductory offer**, such as 7 days, to each product.
2. **RevenueCat:** create a project, add both apps, and import the products.
   - Create an entitlement named **`pro`** and attach both products.
   - Create an offering, mark it **Current**, and add `$rc_monthly` and `$rc_annual` packages.
3. Copy `.env.example` to `.env.local` and fill in the public SDK keys:
   ```
   EXPO_PUBLIC_REVENUECAT_IOS_KEY=appl_...
   EXPO_PUBLIC_REVENUECAT_ANDROID_KEY=goog_...
   ```

The paywall loads the current offering, selects the annual plan by default, and shows the trial length from the store's intro offer. It also includes Restore Purchases, which Apple requires.

## Project structure

```
src/
  app/                    routes (Expo Router)
    (tabs)/               Invoices, Estimates, Clients, Reports, Settings
    document/[id].tsx     invoice/estimate editor
    client/[id].tsx       client details + history ("new" to create)
    client-picker.tsx     modal: pick a client for a document
    payment.tsx           modal: record a payment
    signature.tsx         modal: signature pad
    catalog.tsx           saved items (manage, or pick with ?docId=)
    business.tsx          business profile & logo
    paywall.tsx           subscription paywall
  components/             UI primitives, number field, signature pad, list screen
  hooks/                  theme, Pro gate
  lib/
    calc.ts               pure totals, status and date math (+ calc.test.ts)
    store.ts              persisted Zustand store and all mutations
    purchases.ts          RevenueCat wrapper, entitlement and free-tier limits
    pdf.ts                HTML → PDF templates, preview and share
    types.ts              domain model
```

## Roadmap

These are the planned features for a clear lead over other invoice apps:

- **Cloud sync and backup** across devices, with an account (for example Supabase or Firebase).
- **Online payments:** a "Pay now" link on every invoice through Stripe Payment Links, with invoices marked paid automatically by webhook.
- **Automatic reminders** through push notifications before and after the due date, plus reminder emails to clients.
- **Recurring invoices** (weekly, monthly or yearly retainers).
- **Expenses and receipt scanning** with OCR, and profit reports.
- **Time tracking** that turns tracked hours into line items.
- **Invoice read tracking** ("client viewed your invoice").
- **CSV and PDF export** of reports for accountants, and QuickBooks and Xero export.
- **Multiple businesses** per account and team members.
- **Localization** and per-country tax presets (VAT, GST, HST).
- **Home screen widgets** showing outstanding and overdue totals.

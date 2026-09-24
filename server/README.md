# Invoice Maker API

The backend for the app's cloud features: accounts, sync, emailed invoices, hosted invoice links with online payment, automatic reminders and recurring invoices. It uses Node 22, Express 5 and Postgres. The invoice math and HTML template come from the app (`../src/lib`), so the hosted invoice page always matches the PDF.

## How it works

| Feature | How it works |
| --- | --- |
| **Accounts** | Passwordless sign-in: the server emails a 6-digit code, and the app trades the code for a 180-day token. Codes expire after 10 minutes and allow 5 attempts. `DELETE /v1/me` deletes the account and its data, which Apple requires. |
| **Sync** | The app works offline and syncs through `POST /v1/sync`. Each device pushes its changed records and pulls everything after its cursor. When two devices edit the same record, the newer edit wins. The server stores records as JSON, one row per invoice, client, item or profile. |
| **Server-owned fields** | Online payments and the "viewed" time are written by the server. They are re-applied whenever a device pushes an older copy of an invoice, so a phone that was offline can't erase a payment. |
| **Invoice links** | `/i/:token` shows the invoice (same template as the PDF) with **Download PDF** and **Pay** buttons. The first time the client opens it, the invoice is marked viewed and the owner gets a push notification. The app's own preview adds `?preview=1`, so it doesn't count as a view. |
| **Online payments** | Uses Stripe Connect with Express accounts. Each business connects its own Stripe account, and clients pay through Stripe Checkout straight to that account; you can optionally take a platform fee (`PLATFORM_FEE_BPS`). A Connect webhook records the payment (safe to receive twice), updates the invoice and sends the owner a push notification. |
| **Reminders** | A background job runs every 15 minutes. For unpaid invoices that have been sent, it emails the client N days before the due date, on the due date, and every N days after, up to a limit. Each reminder is sent at most once, only between 9:00 and 20:00 in the user's time zone. |
| **Recurring invoices** | The same job creates the next invoice when its date arrives. It takes the next number from the user's profile and emails the invoice automatically if that's turned on. After downtime it catches up on missed dates. Monthly dates are calculated from the first invoice, so the 31st stays the 31st where the month has one. |
| **Estimate approval and deposits** | Estimate links have an **Accept** form: the client types their name, the estimate is marked accepted, and the owner gets a push notification. If the estimate asks for a deposit, a **Pay deposit** button appears. Invoices with a deposit offer **Pay deposit** or **Pay in full**. Deposits paid on an estimate carry over to the invoice when it's converted. |
| **Late fees** | A background job adds one "Late payment fee" line (a percentage of the balance or a flat amount) to sent invoices once they're overdue by more than the grace period. It then notifies the owner. |
| **AI** | `POST /v1/ai/receipt` reads a receipt photo, and `POST /v1/ai/draft-items` turns a job description into line items using the user's saved item prices. Both call Claude (`claude-opus-5`) at low effort with structured outputs, so replies always match the expected fields. If Claude declines a request, the server's automatic fallback retries it on another model. Set `ANTHROPIC_API_KEY` to turn these on. |
| **Pro check** | Everything except sign-in needs Pro. The server asks RevenueCat and caches the answer (1 hour for Pro, 5 minutes for not Pro). The app calls `Purchases.logIn(userId)` after sign-in, so both sides use the same user ID. |

If you run more than one server instance, a Postgres advisory lock makes sure only one of them runs the background jobs.

## Development

```bash
cd server
npm install
cp .env.example .env         # fill in DATABASE_URL, PUBLIC_URL, JWT_SECRET
npm test                     # integration tests on in-memory Postgres (PGlite); Stripe/email/push are faked
npm run typecheck
npm run build && node --env-file=.env dist/index.js
```

Point the app at the server with `EXPO_PUBLIC_API_URL=http://<your-computer's-LAN-IP>:3000` in the app's `.env.local`.

Without Resend keys, emails (including sign-in codes) are printed to the server log. Without a RevenueCat key, every user counts as Pro, except when `NODE_ENV=production`.

## Deploying to Railway

1. Create a Railway project from this GitHub repo. The root `railway.json` builds `server/Dockerfile` and checks `/health`.
2. Add a **Postgres** database to the project. Set `DATABASE_URL` to `${{Postgres.DATABASE_URL}}`.
3. Set `NODE_ENV=production`, `JWT_SECRET` (use `openssl rand -hex 32`), and `PUBLIC_URL` (the service's public domain), plus the keys below.
4. Migrations run automatically when the server starts.

### Email (Resend)
Verify a sending domain in Resend. Then set `RESEND_API_KEY` and `EMAIL_FROM` (for example `invoices@mail.yourdomain.com`). Emails show the business's name as the sender, and replies go to the business's own email address.

### Stripe Connect
1. In the Stripe Dashboard, turn on **Connect** and choose Express accounts. Set your platform branding.
2. Set `STRIPE_SECRET_KEY`.
3. Add a webhook endpoint at `https://<PUBLIC_URL>/stripe/webhook` that **listens to events on connected accounts**. Select `checkout.session.completed`, `checkout.session.async_payment_succeeded` and `account.updated`. Put its signing secret in `STRIPE_WEBHOOK_SECRET`.
4. Optional: set `PLATFORM_FEE_BPS` (for example `50` for 0.5%) to take a fee on each payment.

### RevenueCat
Set `REVENUECAT_SECRET_KEY` (a v1 secret key) and make sure the entitlement is named `pro`, or set `REVENUECAT_ENTITLEMENT`.

### Push notifications
Run `npx eas-cli@latest init` in the app so it gets an EAS `projectId`, and set up push credentials (APNs and FCM) with EAS. If you turn on enhanced push security in Expo, set `EXPO_ACCESS_TOKEN`.

### AI (Claude)
Set `ANTHROPIC_API_KEY`. Scanning a receipt or drafting items is one short request each. Without the key, those endpoints return `503 ai_not_configured` and the app shows an error.

### App review
App Store and Play reviewers can't receive your emails. Set `REVIEW_LOGIN_EMAIL` and `REVIEW_LOGIN_CODE` (6 digits) and put them in the review notes.

## API

| Method | Path | |
| --- | --- | --- |
| POST | `/v1/auth/start` | `{ email }` emails a sign-in code |
| POST | `/v1/auth/verify` | `{ email, code }` returns `{ token, user }` |
| GET | `/v1/me` | Account, Pro status and Stripe status (`?refresh=1` re-checks RevenueCat) |
| DELETE | `/v1/me` | Delete the account |
| POST/DELETE | `/v1/devices` | Register or remove an Expo push token |
| POST | `/v1/sync` | `{ cursor, changes[] }` returns `{ cursor, hasMore, changes[] }` · Pro |
| POST | `/v1/documents/:id/share` | Create or return the hosted link · Pro |
| POST | `/v1/documents/:id/send` | `{ to, message? }` emails the document · Pro |
| POST | `/v1/ai/receipt` | `{ image (base64 JPEG) }` returns vendor, date, total, tax, currency and category · Pro |
| POST | `/v1/ai/draft-items` | `{ description, currency }` returns `{ items[], notes }` · Pro |
| POST | `/v1/stripe/connect` | Returns the Stripe onboarding link · Pro |
| GET | `/v1/stripe/status` | Whether the account is connected and can accept charges |
| POST | `/v1/stripe/dashboard` | Returns a Stripe Express dashboard login link |
| GET | `/i/:token` | Hosted invoice page (public) |
| POST | `/i/:token/pay` | `amount=deposit\|balance` redirects to Stripe Checkout (public) |
| POST | `/i/:token/accept` | `name=…` accepts an estimate (public) |
| POST | `/stripe/webhook` | Stripe Connect webhook |
| GET | `/health` | Liveness and database check |

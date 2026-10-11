# OpsMitra — Your Business, Simplified by AI

OpsMitra is an AI-assisted business operations platform for small business owners. Inventory, billing, orders, customers, suppliers and reports live in one workspace, and the app tells you in plain language what needs attention (restock this, chase that payment, this item is expiring).

This repository is a **working prototype** built to be presented: every screen is connected to a real API and database, and a one-click demo workspace is pre-filled with 90 days of realistic data.

## Quick start

Requires **Node.js 20+** (tested on Node 24).

```powershell
npm run install:all          # root, client and server dependencies
copy server\.env.example server\.env
# edit server\.env: set JWT_SECRET to a random string of 32+ characters
npm run dev                  # API on :4000, web app on http://localhost:5173
```

Open http://localhost:5173 and press **Try the live demo** (no sign-up). Or create an account and use **Load sample data** on the empty dashboard.

One-process mode (API serves the built app on http://localhost:4000):

```powershell
npm start                    # builds the client, then starts the server
```

## What it does

| Area | Highlights |
|---|---|
| **Accounts** | Register / sign in, forgot & reset password, change password, sign out of all devices, business profile (name, GSTIN, address) used on invoices, one-click private demo workspace |
| **Inventory** | Search, filters, sorting, pagination (all kept in the URL), cost price & margin, GST rate, units, barcode, expiry, stock-movement ledger for every change, adjust stock with a reason, CSV import & export, restore deactivated products |
| **Billing (POS)** | Tap-to-add product grid, barcode/SKU Enter-to-add, discounts (₹ or %), UPI/cash/card/bank/credit, partial payment, printable GST invoice, void a sale (stock returns), WhatsApp share |
| **Orders** | Pending → processing → ready → completed with notes and expected date; completing deducts stock and creates the invoice, cancelling reverses both |
| **Customers** | Lifetime spend, purchase history, usual items, credit balance, record payments (oldest dues first), archive |
| **Suppliers & purchases** | Supplier records, "Receive stock" raises quantity, updates cost price and writes the ledger |
| **Reports** | Revenue, gross profit & margin vs the previous period, category / payment-method / customer breakdowns, GST summary, stock valuation, custom date ranges, CSV export, print |
| **Insights** | ~15 explainable rules (out of stock, days-of-stock-left with suggested order quantity, expiring items, overdue credit, thin margins, dead stock, top customers, win-back list, weekday pattern, month pace…) each showing its evidence, plus a 7-day statistical sales estimate |
| **Ask OpsMitra** | Chat assistant that answers from your live data through fixed read-only queries. Uses Claude when `ANTHROPIC_API_KEY` is set, otherwise a built-in engine — the app never depends on a network call |
| **Everywhere** | Ctrl/⌘+K search & quick actions, live notification bell, light/dark/system theme, responsive down to phones, keyboard and screen-reader friendly |

### AI honesty

- Insights are **rules over your records**, not a predictive ML model, and every card shows the numbers behind it.
- The sales estimate is a **same-weekday average scaled by recent trend** and is labelled an estimate everywhere.
- The assistant can only *read* your data (eight closed-schema tools). It cannot change records.

## Demo walkthrough (5 minutes)

1. Landing page → **Try the live demo**. The dashboard shows today's sales vs yesterday, profit, restock needs, money owed and open orders.
2. **Needs your attention** → open the out-of-stock insight → **Inventory** → product page with its stock history.
3. **Sales → New sale**: add items, a 5% discount, pay by UPI, complete → printable invoice. Repeat on **Credit** for a customer, then **Customers → Record payment**.
4. **Orders**: advance an order to completed (choose how it was paid) and watch stock and the invoice appear; cancel it and watch both reverse.
5. **Reports**: change the period, compare with the previous one, open GST summary, export CSV.
6. **Ask OpsMitra**: "What should I restock this week?", "Who owes me money?", "What will sales look like next week?"
7. Toggle dark mode, open the phone-sized view, press Ctrl+K.

## Commands

```powershell
npm run dev          # API + Vite dev server with hot reload
npm start            # production-style single process on :4000
npm run build        # build the React app into client/dist
npm test             # server (47 tests) + client (10 tests)
npm run lint         # ESLint for server, client and e2e
npm run check        # syntax-check every server file
npm run test:e2e     # browser end-to-end run (see below)
npm run verify       # lint + check + tests + build + e2e
.\scripts\smoke-test.ps1   # legacy API smoke test against a running server
```

**Browser e2e** (`e2e/`) drives the real app in Chromium: demo login, every route, POS, credit and payments, CSV import, orders, assistant, auth flows, session revocation, dark mode and phone layout. First time only: `npx playwright install chromium`, then `npm run build && npm run test:e2e`. It starts its own server on a throw-away database and writes screenshots to `e2e/shots/`.

## Configuration (`server/.env`)

| Variable | Purpose |
|---|---|
| `JWT_SECRET` | **Required.** Random string, 32+ characters |
| `CLIENT_ORIGIN` | Allowed browser origin(s), comma separated |
| `SQLITE_PATH` | Database file (default `server/data/opsmitra.sqlite`) |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | Optional. Enables the Claude-powered assistant (default model `claude-opus-5-5`) |
| `PROTOTYPE_RESET_LINKS` | Shows the password-reset link on screen (no email service). Always off in production unless set to `true` |
| `AUTH_MAX_ATTEMPTS` | Sign-in attempts per IP per 15 min (default 30) |
| `SERVE_CLIENT` | Serve `client/dist` from the API process (default `true` if built) |
| `TRUST_PROXY_HOPS` | Number of reverse proxies in front of the API |

## Project layout

```
client/src
  App.jsx                routes + guards (RequireAuth / PublicOnly)
  context/               Auth (server-verified session), Theme, Toast+Confirm
  layouts/AppLayout.jsx  sidebar, topbar, search palette, notifications
  pages/public/          landing + sign-in / register / password reset
  pages/app/             dashboard, inventory, sales, POS, orders, customers,
                         suppliers, reports, insights, assistant, settings, help
  components/            UI kit, charts, POS builder, command palette
  lib/                   api client, URL-state + query hooks, formatting, CSV
server/src
  app.js / index.js      Express app and listener
  routes/                one file per resource
  services/              analytics, business facts, insight rules, assistant,
                         demo seed, stock ledger, numbering, idempotency
  middleware/            JWT/cookie auth, session-revocation check
server/sql/sqlite-migrations/   ordered, one-time schema upgrades (applied automatically)
e2e/                     Playwright browser smoke test
```

## How money and stock stay correct

- Every sale, order completion, cancellation, void, purchase and adjustment runs in **one database transaction** and writes a **stock-ledger** entry; a product's ledger always ends at its current quantity.
- Prices, cost and GST rate are **snapshotted on each sale line**, so history never changes when you edit a product.
- Money maths is done in integer paise; discounts can't exceed the subtotal; payments can't exceed what is owed.
- Create requests carry a UUID **idempotency key**: a retried request returns the original record instead of duplicating it.
- `GET /api/health` verifies the schema, unique indexes, order↔sale links, line totals and payment sanity. The tests and e2e run assert it stays `ok`.
- Profit = sales net of the GST included in prices, minus cost at time of sale, minus discounts. Set cost prices for accurate figures.

## Security

HttpOnly, SameSite=Strict session cookies (Secure in production); custom-header CSRF check on writes; bcrypt password hashing; per-IP auth throttling; password change / reset / "sign out everywhere" revoke other sessions via a token version; every query is scoped to the signed-in account; LIKE-wildcard-safe search; strict CSP on the served app; CSV exports neutralise spreadsheet formulas.

## Deploying

`docker compose` runs the API (SQLite on a named volume) behind nginx on http://localhost:8080:

```powershell
copy .env.docker.example .env      # set JWT_SECRET, optionally ANTHROPIC_API_KEY
docker compose up --build
```

For anything public: terminate TLS in front, set `CLIENT_ORIGIN` to your real origin, set `PROTOTYPE_RESET_LINKS=false`, back up the data volume, and replace the reset-link shortcut with real email. SQLite suits a single instance.

## Known limitations (by design for a prototype)

- No email/SMS delivery (reset links are shown on screen), no payment gateway, no e-invoicing or filed GST returns (the GST screen is a management summary), no supplier-side sync, no barcode-camera scanning (keyboard/USB scanners work), no staff roles or multi-branch.
- Returns are modelled as voiding a whole sale; partial returns are not implemented.
- MySQL support ended after Phase 4. To move an old MySQL database: `npm run migrate:mysql-to-sqlite --prefix server` (read-only against MySQL; the app then upgrades the copy automatically).
- See `VERIFICATION_REPORT.md` for exactly what has and has not been verified.

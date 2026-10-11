# OpsMitra 1.0 — Verification Report

Run date: 2026-10-11 · Windows 11, Node 24, Chromium (Playwright 1.64).

## Result

The full pipeline `npm run verify` (lint → syntax check → server + client tests → production build → browser end-to-end) passes. Items that could **not** be verified in this environment are listed explicitly at the end.

## Automated checks that ran and passed

| Check | Result | What it covers |
|---|---|---|
| ESLint (`npm run lint`) | PASS, 0 errors / 0 warnings | server, client, e2e (React hooks rules included) |
| Syntax check (`npm run check`) | PASS, 44 files | every server source/script/test file |
| Server tests (`npm test --prefix server`) | **47 / 47 pass** | see below |
| Client unit tests (vitest) | **10 / 10 pass** | CSV escaping/parsing (formula neutralising, BOM), money/date formatting, query-string helper |
| Production build | PASS | initial bundle ≈ 93 kB gzip; charts lazy-loaded (≈ 119 kB gzip) |
| Browser e2e (`npm run test:e2e`) | **52 / 52 steps pass** | real Chromium against the built app; see below |
| Legacy `scripts/smoke-test.ps1` | PASS | the original API smoke test, updated for the new seed/behaviour, run against a fresh server |
| `docker compose config` | PASS | compose file validates |
| Upgrade of an existing Phase 4 database | PASS | a copy of the real local database and a synthetic old-schema database with sales: migration applied once, existing completed sales backfilled as fully paid, voided sales excluded from revenue, customer balances 0, `/api/health` integrity `ok` |

### Server tests (47)

- **28 original tests** (validation, money maths, idempotency, order rules, rate limiting, cookie auth, SQLite adapter) — all still pass; one was updated for the new sale-insert contract.
- **14 API integration tests** (`test/api.test.js`) that boot the real app on a throw-away database and exercise: registration/`/auth/me`/`/auth/session`, profile & GSTIN validation, session revocation (sign out everywhere, password change), single-use password reset, extended product fields, stock ledger, SKU rules, bulk import, discounts/GST/cost snapshots, credit rules, customer payments (partial, overpay rejected, settle), idempotent retries, voiding, order completion/cancellation with ledger and balances, purchases/suppliers, tenant isolation, report maths, the demo workspace (ledger tail == current quantity for every product, insights, forecast, notifications, search, assistant answers, reset, real accounts can never be reset), sample-data loading, LIKE-wildcard-safe search, CSP header.
- **5 assistant tests** (`test/assistant.test.js`) with a scripted stand-in for the Anthropic client: the tool-use round trip and message shapes, closed tool schemas, owner scoping, unknown-tool handling, and fallback to the built-in engine on API errors, refusals and truncation.
- **The health endpoint's integrity check** (`integrity: ok`) is asserted after sales, voids, orders, cancellations and demo seeding.

### Browser e2e (52 steps)

Landing → route guard with return path → demo login honouring `?next` → deep link survives refresh → all 20 routes load → drill-downs (product, invoice, customer, order, supplier, purchase) → POS (credit needs a customer, discount, cash sale → invoice) → record a payment → add product, SKU conflict message → adjust stock → CSV import (2 imported, 1 skipped) → Ctrl+K palette → notification bell → assistant Q&A → advance an order to completed with a payment method → dark theme persists across reload → session revoked from another device sends the user to sign in → 404 inside the app → sign-out → register → sample data → change password → forgot/reset password → phone viewport (drawer navigation, POS, and no horizontal overflow on five pages).
The only browser console messages are the two intentional ones (a 409 from the duplicate-SKU test and a 401 from the revoked-session test); there were no page errors and no CSP violations.

## Bugs found and fixed during verification

- Top-products report excluded **today's** sales while the totals included them (original code passed the wrong end date). Fixed; covered by a regression test.
- UI said data was "stored in MySQL" although SQLite is the default. Removed with the rewrite.
- Shell-quoting damage to the LIKE-escaping helper and the CSV byte-order mark was found by lint/unit tests and fixed, with regression tests for both.
- Auth cache was cleared in a way that left the auth context stale after demo login/registration (found by e2e). Fixed.
- The original server Docker image did not copy the `sql/` directory the SQLite driver needs. Fixed in the new Dockerfile.

## Not verified — please be aware

1. **The live Claude call.** No `ANTHROPIC_API_KEY` is available here, so the assistant's real API round trip has not run. The request construction, tool loop, message replay and error/refusal fallbacks are tested against a scripted client; the first real call should be checked once with your key (`/app/settings/about` shows whether the assistant is in Claude or built-in mode).
2. **Docker images.** The Docker daemon was not running, so images were not built or started; only `docker compose config` was validated. The Dockerfile change (copying `sql/`, `/data` volume) is untested.
3. **Other browsers and real devices.** e2e ran in headless Chromium at desktop and 390 px widths; Safari/Firefox and physical phones were not tested. Printing/PDF output was not visually inspected.
4. **MySQL → SQLite import.** Unchanged from before and still not run (no MySQL server available). The app upgrades an imported database automatically on first start.
5. **Performance at scale.** Tested with roughly 900 sales over 90 days and 37 products per demo workspace; SQLite is intended for a single instance.
6. **Accessibility.** Labels, roles, focus handling, skip link, reduced-motion and colour tokens were built in, but no screen-reader or automated axe audit was run.

## Scope notes

- MySQL support was retired (SQLite is required); legacy MySQL data can be imported.
- Email, payment gateway, filed GST returns/e-invoicing, staff roles and partial returns are intentionally out of scope for this prototype (see README).

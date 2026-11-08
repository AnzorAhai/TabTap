# TabTap

Pay-at-table by QR code. A guest scans the QR code on the table, sees the bill pulled from the
restaurant's POS, and pays the whole bill, their own dishes, or an equal share — with a tip. The
restaurant sees tables, QR codes and incoming payments in the admin panel.

First market: Venezuela. Product plan and decisions: [docs/ROADMAP.md](docs/ROADMAP.md).

## Repository layout

| Path              | What                                                              |
| ----------------- | ----------------------------------------------------------------- |
| `apps/api`        | Backend — NestJS 12, PostgreSQL via `pg` (no ORM)                 |
| `apps/guest-pwa`  | Guest web app — React 19 + Vite 8                                 |
| `apps/admin`      | Restaurant admin panel — React 19 + Vite 8                        |
| `packages/shared` | API types and money helpers shared by all apps (built on install) |
| `db/migrations`   | SQL migrations, applied in filename order by `db/migrate.mjs`     |
| `db/*.mjs`        | Migration runner, local Postgres, demo-data reset                 |

POS systems and payment gateways are adapters behind interfaces
(`apps/api/src/integrations/pos`, `apps/api/src/integrations/payments`). Today only mock adapters
are wired up: an in-memory demo POS with three Venezuelan-style bills (USD, IVA 16%, 10% service)
and a payment provider that moves no real money.

## How payments work

- A guest pays the **whole remaining bill**, **their own lines**, or **N shares** of an equal split
  that is shared by the whole table. The client only says _what_ it pays for; the server computes
  every amount (line totals include their tax and share of the service charge).
- Every bill has one remaining amount: total − settled payments − payments in progress. A payment
  in progress (`pending`) holds its lines/shares for `PAYMENT_HOLD_MINUTES`; if it fails, is
  canceled or the hold expires, they become available again. Overpaying is impossible, and
  concurrent requests are serialized per bill.
- Bills are in the POS currency (USD). The guest picks a **payment method**; the method decides
  the currency, and VES amounts use the restaurant's current USD→VES rate (stored on the payment).
- `POST /bills/:billId/payments` requires an `Idempotency-Key` header: retrying a "Pay" tap never
  charges twice. Settlement, the receipt and the POS notification are written in one transaction;
  a background worker delivers POS notifications and retries while the POS is unreachable.
- Everyone at the table sees changes live: `GET /bills/:billId/events` is a server-sent event
  stream ("bill.updated" → refetch the bill).
- The platform fee (1.5% by default, `tenants.platform_fee_bps`) is recorded on each payment's
  bill amount, tips excluded. Only platform admins can change it.

## Payment methods (Venezuela)

Guests pay the restaurant directly; TabTap records every payment and its fee, and the fee report
(per restaurant and for the platform) is the basis for a monthly invoice.

| Method        | Currency | Confirmed by                                                    |
| ------------- | -------- | --------------------------------------------------------------- |
| Card          | bill     | the payment gateway (mock today)                                |
| Pago Móvil    | VES      | guest reports the bank reference → staff, or the demo simulator |
| Zelle         | USD      | guest reports the confirmation → staff                          |
| Binance Pay   | USD      | guest reports the order id → staff                              |
| Cash USD / Bs | USD/VES  | the waiter, in the admin panel ("Деньги получены")              |

Each restaurant enables methods, enters where guests send the money (bank/phone/RIF, Zelle email,
Binance Pay ID) and an optional surcharge per method — for example IGTF 3% on foreign currency
received outside the Venezuelan banking system, which special taxpayers must collect (check with an
accountant). Offline payments hold the lines/shares for `PAYMENT_HOLD_MINUTES_OFFLINE` (30).

The demo simulator ("simulated" verification) confirms any reported reference after
`SIMULATED_CHECK_SECONDS` and rejects references ending in `0000`. Real bank checks (Pago Móvil
verification APIs, Binance Pay) plug in per bank once there is a partner.

Restaurants with rate source **BCV** get the official USD→VES rate from `BCV_RATE_URL` (DolarAPI
format) every hour; staff can also take it on demand or enter a rate by hand.

## Demo POS

With `POS_CONNECTOR_TYPE=demo` the demo restaurant (`tenants.is_demo`) gets a waiter's screen in the admin
panel: orders are punched from a menu in the database and reach guests like a bill from a real POS. A
"reset demo" button wipes that restaurant's orders, bills and payments; tables, QR codes, menu and settings
stay. Other restaurants get 404 from these endpoints. The script for showing it: [docs/DEMO.md](docs/DEMO.md).

The default `mock` connector keeps three fixed bills in memory and is what the tests use.

## Isolation between restaurants

Requests under `/tenants/:tenantId` run on one connection switched to the restricted `tabtap_app` role with
`app.current_tenant_id` set, so row-level security limits every query to that restaurant, even one that forgets
its filter. Guest endpoints, background jobs and `/platform` work across restaurants and keep the owner
connection. A new table with a `tenant_id` column needs a `tenant_isolation` policy; a test fails without one.

This switches session state, so `DATABASE_URL` must not be a transaction pooler (Supabase's port 6543); the API
refuses to start with one.

What is left before real restaurants: [docs/LAUNCH.md](docs/LAUNCH.md).

## Refunds

Owners and managers can refund a completed payment from the Payments page. Card payments go back
through the gateway; offline money is returned by staff, and the refund records who did it and why.
A refunded payment stops counting towards sales and the platform fee, and what it covered becomes
payable again unless the POS has closed the bill. The POS is not told: voiding at the register stays
with the restaurant.

## Staff access

The admin panel needs a sign-in (login + password). Each person has a role per restaurant:

| Role     | Can                                                                            |
| -------- | ------------------------------------------------------------------------------ |
| Owner    | Everything in the restaurant, including staff, roles and the restaurant name   |
| Manager  | Tables and QR codes, exchange rate, payment settings, invite/remove waiters    |
| Waiter   | See tables, payments and the rate                                              |
| Platform | (TabTap staff) every restaurant as owner, onboarding restaurants, fees, resets |

Accounts are created by invitation: the inviter gets a one-time link (valid 72 h) to send by
WhatsApp/Telegram, and the new person chooses their password through it. No email is sent.
The API stores only hashes of passwords (scrypt), sessions and links; the admin panel sends the
session as `Authorization: Bearer <token>` (sessions last `SESSION_TTL_DAYS`, 14 by default).

The very first account is created from the command line, against the database in `DATABASE_URL`:

```bash
npm run users:invite -- --login you --platform-admin --tenant 11111111-1111-1111-1111-111111111111 --role owner --admin-url http://localhost:5174
```

It prints the link to open. Run it again for a new link if one is lost or a password is forgotten.
Add `--password <password>` to set the password directly and skip the link.

Table QR codes carry a random 128-bit token (`?table=…`); owners and managers can issue a new
one per table ("Новый QR"), which immediately invalidates the printed code.

## Local development

Requirements: Node.js 24 (see `.nvmrc`; 22.12+ works) and npm. For the database, either run
`npm run db:local` (a real PostgreSQL 17 from npm, no Docker; data in `.local/postgres`, leave
it running in its own terminal), `docker compose up -d`, or use a Supabase project.

```bash
npm install                                  # also builds packages/shared
cp apps/api/.env.example apps/api/.env       # then fill in DATABASE_URL
npm run db:migrate                           # schema + demo restaurant with 3 tables
npm run users:invite -- --login you --platform-admin   --tenant 11111111-1111-1111-1111-111111111111 --role owner   # prints your sign-in link
```

Run each in its own terminal:

```bash
npm run dev:api     # http://localhost:3000  (health check: /health)
npm run dev:guest   # open a table from the admin panel: Столы → «Открыть как гость»
npm run dev:admin   # http://localhost:5174
```

The frontends call `http://localhost:3000` unless `VITE_API_URL` is set (see their `.env.example`).

`npm run db:reset-demo` deletes all payments, receipts and equal splits and reopens the bills.

To try asynchronous payments (like Pago Móvil, confirmed later in the bank app), start the API
with `MOCK_PAYMENT_FLOW=manual`: payments stay pending and the guest app (dev build) shows
"bank confirmed / declined" buttons. The exchange rate is set in the admin panel (Курс).

## Checks

| Command             | What it does                                                            |
| ------------------- | ----------------------------------------------------------------------- |
| `npm test`          | Unit tests, and API tests against a real PostgreSQL started for the run |
| `npm run lint`      | ESLint, including type-aware rules                                      |
| `npm run typecheck` | TypeScript in every workspace                                           |
| `npm run format`    | Prettier (`format:check` to only verify)                                |
| `npm run build`     | Builds shared, then the API and both frontends                          |

GitHub Actions (`.github/workflows/ci.yml`) runs all of these on every push to `main` and every
pull request, and applies all migrations to an empty PostgreSQL to catch broken SQL.

## Deploy

| Part        | Where    | Config                                  |
| ----------- | -------- | --------------------------------------- |
| API         | Render   | `render.yaml` (Blueprint)               |
| Guest app   | Vercel   | `apps/guest-pwa/vercel.json`            |
| Admin panel | Vercel   | `apps/admin/vercel.json`                |
| Database    | Supabase | PostgreSQL, migrations run on API start |

### API on Render

Create the service from the Blueprint (`render.yaml`). It builds the API, runs pending migrations
before every start, and uses `/health` (which also checks the database) as the health check.
Environment variables to set in the Render dashboard:

- `DATABASE_URL` — Supabase connection string (session pooler, port 5432).
- `CORS_ORIGINS` — the two Vercel origins, comma-separated. **Required**: the API refuses to start
  in production without it.
- `GUEST_APP_URL` — the guest app's URL, used for the QR links in the admin panel.
- `ADMIN_APP_URL` — the admin panel's URL, used in invite links. **Required** in production; set
  in `render.yaml` (it isn't secret), so the Blueprint applies it.

All variables are described in `apps/api/.env.example`.

### Frontends on Vercel

One Vercel project per app, both from this repository:

- Root Directory: `apps/guest-pwa` (or `apps/admin`). Vercel detects the npm workspace and
  installs from the repository root; the Vite preset defaults are correct.
- Environment variable `VITE_API_URL` = the Render API URL. It is baked in at build time, so
  redeploy after changing it.

### Region

Guests are in Venezuela, so the API and the database should both run in US East: Render region
`virginia`, Supabase region `us-east-1`. Today they run in `oregon` (Render) and `eu-west-1`
(Supabase). Both fix the region when a service/project is created, so moving means creating new
ones:

1. Create a Supabase project in `us-east-1`, copy its connection string.
2. Set `region: virginia` in `render.yaml` and create a new Blueprint instance from it in Render,
   with the variables above and the new `DATABASE_URL`. Migrations and demo data are applied on
   its first start.
3. Point `VITE_API_URL` of both Vercel projects at the new API URL, update `connect-src` in
   `apps/admin/vercel.json` and `apps/guest-pwa/vercel.json` (their Content-Security-Policy) and
   redeploy both.
4. Delete the old Blueprint, Render service and Supabase project.

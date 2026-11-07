# TabTap

Pay-at-table by QR code. A guest scans the QR code on the table, sees the bill pulled from the
restaurant's POS, and pays the whole bill, their own dishes, or an equal share — with a tip. The
restaurant sees tables, QR codes and incoming payments in the admin panel.

First market: Venezuela. Product plan and decisions: [docs/ROADMAP.md](docs/ROADMAP.md).

## Repository layout

| Path              | What                                                          |
| ----------------- | ------------------------------------------------------------- |
| `apps/api`        | Backend — NestJS 12, PostgreSQL via `pg` (no ORM)             |
| `apps/guest-pwa`  | Guest web app — React 19 + Vite 8                             |
| `apps/admin`      | Restaurant admin panel — React 19 + Vite 8                    |
| `packages/shared` | Types shared by all apps (built to `dist/` on `npm install`)  |
| `db/migrations`   | SQL migrations, applied in filename order by `db/migrate.mjs` |
| `db/*.mjs`        | Migration runner and demo-data reset script                   |

POS systems and payment gateways are adapters behind interfaces
(`apps/api/src/integrations/pos`, `apps/api/src/integrations/payments`). Today only mock adapters
are wired up: an in-memory demo POS and a payment provider that settles instantly.

## Local development

Requirements: Node.js 24 (see `.nvmrc`; 22.12+ works), npm, and a PostgreSQL database — either
`docker compose up -d` or a Supabase project.

```bash
npm install                                  # also builds packages/shared
cp apps/api/.env.example apps/api/.env       # then fill in DATABASE_URL
npm run db:migrate                           # schema + demo restaurant with 3 tables
```

Run each in its own terminal:

```bash
npm run dev:api     # http://localhost:3000  (health check: /health)
npm run dev:guest   # http://localhost:5173/?table=table-1
npm run dev:admin   # http://localhost:5174
```

The frontends call `http://localhost:3000` unless `VITE_API_URL` is set (see their `.env.example`).

`npm run db:reset-demo` deletes all splits, payments and receipts and reopens the demo bills.
Restart the API afterwards: the mock POS keeps its bills in memory.

## Checks

| Command             | What it does                                   |
| ------------------- | ---------------------------------------------- |
| `npm test`          | Unit and HTTP tests (Vitest, database mocked)  |
| `npm run lint`      | ESLint, including type-aware rules             |
| `npm run typecheck` | TypeScript in every workspace                  |
| `npm run format`    | Prettier (`format:check` to only verify)       |
| `npm run build`     | Builds shared, then the API and both frontends |

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
3. Point `VITE_API_URL` of both Vercel projects at the new API URL and redeploy them.
4. Delete the old Blueprint, Render service and Supabase project.

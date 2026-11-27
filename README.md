# BEAM Club Management

Internal club management & horizontal calendar task workspace (`/tasks`) for **BEAM Club** (~50 members, 20 departments) — featuring single-device sliding sessions (`30m`), granular 18-permission RBAC, department leads, 3-step task coordination (Assign → Accept → Submit Deliverables) with bilingual `vi`/`en` Web + SMTP notifications, append-only history & undo, Archive Center, Branding/Login Gallery, and automated GitHub Actions CI/CD to Neon PostgreSQL & Vercel (`sin1`).

> **Switching machines?** Run the 3 commands in **Quick Start** below, then read [`AGENTS.md`](AGENTS.md) and the **Cross-Machine Handoff** section at the bottom of [`docs/STATUS.md`](docs/STATUS.md).

## Prerequisites

- **Node.js `>= 20`** (GitHub Actions CI uses Node 22; tested on macOS, Windows, and Linux)
- **PostgreSQL 16** via one of:
  - **Docker Compose** (recommended for switching machines — Docker Desktop on macOS/Windows or Docker Engine on Linux)
  - **Native PostgreSQL 16** (Homebrew `postgresql@16` on macOS, PostgreSQL installer on Windows, `postgresql` package on Linux)
  - **Remote dev PostgreSQL** (e.g. a Neon dev branch — never point local tools at production)
- **Google Chrome** or Playwright Chromium (`npx playwright install chromium`) for E2E tests

## Quick Start (Any Machine)

```bash
npm install
npm run setup
npm run dev
```

`npm run setup` performs a safe, idempotent bootstrap:
1. Creates `.env.local` from `.env.example` (if missing) with freshly generated random `SESSION_SECRET` and `CRON_SECRET`. Existing `.env.local` files are preserved.
2. Starts local PostgreSQL via `docker compose up -d` if port `5432` (or `POSTGRES_PORT`) is not yet reachable and Docker is running.
3. Ensures both `beam_dev` and `beam_test` databases exist (`npm run db:ensure`).
4. Applies SQL migrations to dev and test databases (`npm run db:migrate` & `npm run db:migrate -- --test`).
5. Applies synthetic development & test seed data (`npm run db:seed` & `npm run db:seed -- --test`, required by E2E permission preset tests).
6. Verifies the machine environment with `npm run doctor`.

## Flexible Cross-Machine Overrides

Configure any of these in `.env.local` or shell environment without modifying tracked files:

| Variable | Default | Purpose |
|---|---|---|
| `POSTGRES_PORT` | `5432` | Host port mapped by `docker-compose.yml` and used by `npm run setup` when generating `.env.local` |
| `DATABASE_URL` | `postgresql://beam_dev:beam_dev_password@localhost:5432/beam_dev` | Dev PostgreSQL connection string |
| `TEST_DATABASE_URL` | `postgresql://beam_dev:beam_dev_password@localhost:5432/beam_test` | Isolated PostgreSQL connection string for integration & E2E tests |
| `PLAYWRIGHT_PORT` | `3001` | Local port used by Playwright `webServer` |
| `PLAYWRIGHT_CHANNEL` | auto-detect (`chrome` if installed, else Chromium) | Set `none` or `chromium` to use Playwright's bundled Chromium instead of system Chrome |

### Switching Between Docker and Native PostgreSQL

- **Docker Compose:** Start Docker Desktop / Engine, then run `npm run db:up` (or `npm run setup`). Fresh volumes automatically create both `beam_dev` and `beam_test` via `db/docker-init/01-create-test-db.sql`.
- **Native PostgreSQL (e.g. macOS Homebrew):**
  ```bash
  brew install postgresql@16
  brew services start postgresql@16
  ```
  Ensure role `beam_dev` exists (or point `DATABASE_URL` / `TEST_DATABASE_URL` in `.env.local` to your local role), then run `npm run setup`.
- **Conflict on port 5432:** Set `POSTGRES_PORT=5433` in your environment before `npm run setup` and `npm run db:up`.

## Dev Seed Accounts

Synthetic seed data is defined in `db/seed.sql` (non-production only; `npm run db:seed` blocks `NODE_ENV=production` and non-local hosts unless `--allow-remote` is explicitly passed).

- **Default password for seeded dev accounts:** `BeamDev@2026`
- See `db/seed.sql` for seeded student IDs (e.g. `MSSV-ADMIN-01` for Admin, `MSSV-DEV-001` for Member) and roles.

## Verification Commands

```bash
npm run doctor            # Check Node, .env.local, Postgres dev/test, Chrome/Playwright, OpenAPI types
npm run typecheck         # TypeScript strict check
npm run lint              # ESLint + code quality thresholds (AGENTS.md 6A.6)
npm run arch:check        # dependency-cruiser layered architecture check (AGENTS.md 6A.2)
npm run openapi:check     # Verify src/features/shared/api/schema.d.ts matches docs/openapi.yaml
npm run test:unit         # Vitest unit tests
npm run test:integration  # PostgreSQL integration tests (requires TEST_DATABASE_URL)
npm run build             # Next.js production build
npm run test:e2e          # Playwright end-to-end suite (requires build + TEST_DATABASE_URL)
npm run db:backup         # Safe pg_dump SQL backup (dev/test only; blocks NODE_ENV=production)
npm run db:restore:verify # Isolated temp-DB restore, schema, row-count & trigger verification
npm run db:bootstrap-admin # Owner-only CLI to create/reset the initial Club Admin without dev seed data
npm run smtp:verify -- --to admin@eiu.edu.vn # Verify real SMTP delivery into primary inbox before Go-Live
```

## Release, Operations & Governance Docs

- Governance & layered architecture rules: `AGENTS.md` and `docs/STATUS.md`
- Deployment, `0đ/month` Go-Live Runbook (Neon + Vercel `sin1` + Gmail/Brevo SMTP + GitHub Cron), weekly `pg_dump` backup & club handover (`NFR-06`, `NFR-08`): `docs/OPERATIONS.md`
- 1-week club UAT checklist (`HANDOFF §9`, `AC-01`..`AC-22`): `docs/UAT-CHECKLIST.md`
- API & schema contracts: `docs/openapi.yaml`, `docs/ERD.md`, `docs/TRACEABILITY.md`, `docs/DECISIONS.md`

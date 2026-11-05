# Creme Operations

The workspace, health-check path, domain schema, versioned migrations and exact take-home seed are implemented. All six business endpoints and the staff readiness/booking board are implemented. See [API behavior and decisions](DECISIONS.md). See [plan.md](plan.md) for the full plan and [the task log](odd/tasks/worker-operations.md) for progress.

## Quick start

Prerequisites: Node 22.23.4 (`nvm use`), pnpm 10.19.0, and a running Docker engine with Compose.

```sh
pnpm install --frozen-lockfile
cp .env.example .env
pnpm db:up
pnpm db:seed
pnpm dev
```

Copy `.env.example` only on first setup; do not overwrite an existing `.env`.

- Web: http://127.0.0.1:5173
- API/database health: http://127.0.0.1:3001/api/health
- PostgreSQL: `127.0.0.1:54329`

The web dev server proxies `/api` to Nest. Environment values are loaded from the root `.env`; only `VITE_`-prefixed values may be exposed by Vite. Never put database credentials in a `VITE_` variable. Default credentials are local-only examples, not deployment credentials. All listeners bind to loopback.

## Commands

| Command | Purpose |
|---|---|
| `pnpm dev` | Build shared contracts, then watch both apps |
| `pnpm db:up` | Start PostgreSQL and wait for health |
| `pnpm db:down` | Stop database containers, retaining the data volume |
| `pnpm db:logs` | Follow PostgreSQL logs |
| `pnpm db:generate` | Generate a reviewed SQL migration after a Drizzle schema change; does not connect to PostgreSQL |
| `pnpm db:migrate` | Build the API and apply pending versioned migrations |
| `pnpm db:seed` | Build, migrate, then initialize the exact take-home fixtures; safe to repeat |
| `pnpm test` | Start PostgreSQL and run API integration + web component tests |
| `pnpm lint` | Run Oxlint with warnings treated as failures |
| `pnpm typecheck` | Check TypeScript in both apps, tests and contracts |
| `pnpm build` | Build contracts, API and web |
| `pnpm --filter @creme/api start` | Run the built API |

Database commands use `DATABASE_URL`. Run them from this workspace through the scripts above; the package commands locate migrations relative to `apps/api`. Migrations live in `apps/api/drizzle`; commit their SQL, journal and schema snapshot together when committing is authorized. Do not use ORM schema synchronization.

The first seed requires empty domain tables. It creates the two branches, eleven users, six workers, terms v1/v2, the documented document/QC states, Elena's correction task, and empty appointments APT-1/APT-2. Bruno's two non-passport documents are approved, as recorded in the plan. Subsequent seeds are no-ops: they preserve user changes, bookings and audit history. Existing unrecognized data causes refusal, never truncation. There is no reset option. A database advisory lock serializes concurrent CLI runs; a transaction makes seed data and its bootstrap audit entries atomic.

## Workspace

- `apps/api`: NestJS with Drizzle and a managed `pg` pool. TypeScript compiles decorators and ESM before execution; no runtime transpilation of Nest decorators.
- `apps/web`: React + Vite. The readiness board shows the four gates, appointment capacity and per-worker booking outcomes.
- `packages/contracts`: shared wire types only. Neither Nest nor Drizzle enters the browser dependency graph.

Turbo caches builds/static checks; development and tests are uncached. Database commands run directly, never through a cache. Source configuration and `.env` changes invalidate affected cached tasks.

## Testing and data safety

Compose initializes `creme` for development and `creme_test` for integration tests. API tests require `TEST_DATABASE_URL` with a database name ending in `_test`; they never fall back to the development URL. The health integration test executes SQL against real PostgreSQL through Drizzle. Web tests mock HTTP only to exercise presentation states.

Database initialization runs only when the Docker volume is first created. If reusing an older volume without the test database, create `creme_test` explicitly; do not delete your volume to fix setup. Health tests remain read-only. Database foundation and document HTTP tests create random disposable `creme_<uuid>_test` databases on the local server, apply the real migration/seed CLI, and drop only their own databases. The test role needs `CREATEDB`; neither the development database nor the shared `_test` database is reset. Document HTTP tests cover permissions, idempotency, QC, correction tasks and transactional audit. Operations HTTP tests cover readiness, acceptance, mixed batches, booking races and capacity.

Jest uses Node's experimental VM-module support to run the compiled ESM API tests; the associated warning is expected. Optional Watchman integration is disabled so the suite does not depend on a host Watchman installation. Some upstream dependencies report deprecation warnings during installation; the lockfile records the exact dependency graph.

## Current limits

This is a local demonstration slice, not a production deployment. Authentication is out of scope. All six endpoints enforce scoped access and transactional business writes. The staff board uses server-evaluated readiness and refreshed booking state. Submission write-up and written answers are in DECISIONS.md. The actual recording, private repository sharing and deployment remain separate. Database foreign keys, uniqueness and checks back the structural rules; they do not enforce every business rule. See [the data model](docs/data-model.md) for the boundary. No commits, remote repository or published deployment are created by the setup commands.

## Readiness and booking

Open the web app after seeding. Pedro can view JO-2026-0142 and schedule selected workers; Sofía demonstrates denied cross-branch access. Mixed selections return individual outcomes. See [board usage](docs/readiness-board.md) and [operations endpoints](docs/api-operations.md). `X-User-Id` is only a local demonstration selector, not production authentication.

## Submission materials

- [Decisions and four written answers](DECISIONS.md) — rule enforcement, trade-offs, assumptions, cuts and AI usage.
- [Recording guide](docs/recording-guide.md) — suggested seven-minute demonstration; not an actual recording.
- [Submission checklist](docs/submission-checklist.md) — remaining human review, commit and sharing steps.

The seed does not reset an existing demo. Use a separate fresh database for the starting-state recording; never delete existing development data to recreate the fixture.

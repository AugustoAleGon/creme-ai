# Creme Operations

The workspace and health-check path are implemented in this slice. Domain schema, migrations, seed data, business endpoints and the readiness board follow in later increments. See [plan.md](plan.md) for the full plan.

## Quick start

Prerequisites: Node 22.23.4 (`nvm use`), pnpm 10.19.0, and a running Docker engine with Compose.

```sh
pnpm install --frozen-lockfile
cp .env.example .env
pnpm db:up
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
| `pnpm test` | Start PostgreSQL and run API integration + web component tests |
| `pnpm lint` | Run Oxlint with warnings treated as failures |
| `pnpm typecheck` | Check TypeScript in both apps, tests and contracts |
| `pnpm build` | Build contracts, API and web |
| `pnpm --filter @creme/api start` | Run the built API |

Migration and seed commands belong to the subsequent domain foundation slice. There is no ORM schema synchronization or fake seed command.

## Workspace

- `apps/api`: NestJS with Drizzle and a managed `pg` pool. TypeScript compiles decorators and ESM before execution; no runtime transpilation of Nest decorators.
- `apps/web`: React + Vite. The initial screen checks the real API/database connection.
- `packages/contracts`: shared wire types only. Neither Nest nor Drizzle enters the browser dependency graph.

Turbo caches builds/static checks; development and tests are uncached. Database commands run directly, never through a cache. Source configuration and `.env` changes invalidate affected cached tasks.

## Testing and data safety

Compose initializes `creme` for development and `creme_test` for integration tests. API tests require `TEST_DATABASE_URL` with a database name ending in `_test`; they never fall back to the development URL. The health integration test executes SQL against real PostgreSQL through Drizzle. Web tests mock HTTP only to exercise presentation states.

Database initialization runs only when the Docker volume is first created. If reusing an older volume without the test database, create `creme_test` explicitly; do not delete your volume to fix setup. Health tests remain read-only and do not reset data. These smoke tests do not prove the planned domain rules.

Jest uses Node's experimental VM-module support to run the compiled ESM API tests; the associated warning is expected. Optional Watchman integration is disabled so the suite does not depend on a host Watchman installation. Some upstream dependencies report deprecation warnings during installation; the lockfile records the exact dependency graph.

## Current limits

This is local development scaffolding, not a production deployment. Authentication is out of scope. Domain schema, migrations, seed data, authorization, audit/history enforcement, QC, readiness and concurrency-safe scheduling remain future increments. No commits, remote repository or published deployment are created by the setup commands.

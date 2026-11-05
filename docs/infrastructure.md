# Infrastructure

## Local development

Use Node 22.23.4 from `.nvmrc`, pnpm 10.19.0 and a running Docker engine with Compose.

```sh
pnpm install --frozen-lockfile
cp .env.example .env
pnpm db:up
pnpm dev
```

Copy the example only when `.env` does not already exist. Follow [README.md](../README.md) for the complete command list. Seed and migration commands are future work.

| Service | Default local address | Purpose |
|---|---|---|
| Vite | `http://127.0.0.1:5173` | Web development server; proxies `/api`. |
| Nest | `http://127.0.0.1:3001/api/health` | API/database health. |
| PostgreSQL | `127.0.0.1:54329` | Compose-managed PostgreSQL 16. |

Only PostgreSQL is containerized in the current Compose file. Development data uses the named `postgres-data` volume. `pnpm db:down` stops containers without requesting volume deletion.

## Environment

`.env.example` is the canonical variable list. Root `.env` is ignored by Git. Local example credentials are not deployment credentials. Never expose database credentials through a `VITE_` variable; Vite-prefixed values may enter browser code.

Turbo caches builds and static checks; development and tests are uncached. Database commands run directly. See [turbo.json](../turbo.json) for dependency, environment and cache configuration.

## Test safety

`pnpm test` starts PostgreSQL before running package tests. API tests compile to ESM and run Jest/Supertest against real PostgreSQL. Web component tests run Vitest with mocked HTTP.

- Use `TEST_DATABASE_URL` naming a database ending in `_test`; never fall back to the development database.
- Compose initializes `creme` and `creme_test` by default. Initialization SQL only runs on a fresh volume.
- If an old volume lacks the test database, create that database explicitly; do not delete the volume as a setup repair.
- Jest disables optional Watchman integration and runs with Node experimental VM modules.
- Planned domain concurrency tests need separate database connections, not one enclosing transaction.

## Deployment boundary

The inspected setup defines local development only. No production deployment or CI workflow is established by the current repository configuration; do not infer a hosting provider or pipeline from Compose.

## Related docs

- [Architecture](architecture.md)
- [Claims ledger](claims-ledger.md)

# Creme Operations
Worker document review, readiness and consular appointment scheduling for seasonal-worker operations.

## Where to find things

- [README.md](README.md) — local setup, commands and current limitations.
- [plan.md](plan.md) — agreed implementation scope, design and assumptions.
- [Task log](odd/tasks/worker-operations.md) — original brief, acceptance scenarios and implementation progress.
- [Business context](docs/business.md) — product purpose, actors and R1–R12 rules.
- [Architecture](docs/architecture.md) — current stack, boundaries and planned behavior.
- [Data model](docs/data-model.md) — implemented schema, integrity constraints and remaining application rules.
- [Infrastructure](docs/infrastructure.md) — local services, environment and data safety.
- [ADR index](docs/adrs/README.md) — recorded decisions and their implementation status.
- [ADR template](docs/adrs/adr-template.md) — format for future decisions.
- [Stack decision](docs/adrs/adr-0001-modular-monolith.md) — workspace and persistence choices.
- [Scheduling decision](docs/adrs/adr-0002-order-locking.md) — planned lock protocol and trade-off.
- [Claims ledger](docs/claims-ledger.md) — evidence and unresolved documentation gaps.
- [CLAUDE.md](CLAUDE.md) — Claude entry point delegating to this index.
- [Skill registry](.atl/skill-registry.md) — installed skills and their source paths.

## Commands

```sh
pnpm db:up
pnpm db:seed
pnpm dev
pnpm test
pnpm lint && pnpm typecheck
pnpm build
```

See README prerequisites first. `pnpm db:seed` migrates before seeding and never resets existing data.

## Non-obvious rules

- Setup, database foundation and T2 document workflows are implemented. A planned feature is not permission to implement it; use the current request and `plan.md` for scope.
- The setup plan specifies `main`, with no commits or publication without an explicit request. Use Conventional Commits without AI attribution when commits are requested.
- The full take-home targets four hours, with a five-hour hard stop; record incomplete work honestly rather than adding stretch goals.
- Preserve external job-order identity and historical worker identity. The case system owns job orders; workers outlive a season (R1).
- Preserve the recorded Bruno seed interpretation: non-passport documents are approved so scenario 2 can make him ready. See `plan.md` assumptions.

## Testing

`pnpm test` starts PostgreSQL and runs API Jest/Supertest integration tests plus web Vitest/Testing Library tests. API tests use a dedicated `_test` database; never substitute the development database. Database-seam tests also create and drop their own random local databases. Document HTTP tests cover submissions/QC; readiness and scheduling rules remain deferred. See [test safety](docs/infrastructure.md#test-safety).

## Code style

TypeScript throughout; Oxlint checks lint separately from TypeScript typechecking. Shared contracts contain wire types, not database entities or business logic. Keep technical artifacts in English and load applicable project skills before editing code.

## Security

- Never commit `.env` or credentials; document new variables in `.env.example`.
- Never log secrets or personal document data.
- Local example credentials and `X-User-Id` caller selection are not production authentication. Document endpoints enforce roles, branch and ownership; this does not replace production authentication.

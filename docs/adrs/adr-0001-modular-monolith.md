# ADR-0001: TypeScript modular monolith

## Status

Accepted in [plan.md](../../plan.md#architecture-and-tooling); recorded 2026-11-05. Workspace, connectivity, domain schema, migrations and seed are implemented. Business API modules and the readiness board are implemented.

## Context

The take-home asks for one end-to-end slice under a four-to-five-hour timebox. It mandates TypeScript, React and PostgreSQL, while allowing backend-framework and ORM choices. The brief names NestJS, Fastify and Express as examples, and Vite or Next.js for React.

The delivered choice is NestJS, Vite and Drizzle. [DECISIONS.md](../../DECISIONS.md#1-data-model-and-stack) explains the trade-offs for this slice; no comparative benchmark is claimed.

## Decision

Use pnpm/Turbo with `apps/api` (NestJS), `apps/web` (React/Vite) and `packages/contracts` (wire types only). Access PostgreSQL through Drizzle/node-postgres; version the domain schema with generated SQL migrations in `apps/api/drizzle`.

## Consequences

### Easier

- One workspace coordinates the API, UI and shared wire contracts.
- The modular monolith keeps the requested slice within one backend.

### Harder

- Shared wire types still require independent runtime validation.
- Build ordering must produce contracts before dependent applications.
- ORM selection does not implement audit, retention or concurrency policies automatically.

Drizzle keeps SQL-shaped transactions and constraints visible while adding typed query construction. It does not replace runtime validation or database-design knowledge.

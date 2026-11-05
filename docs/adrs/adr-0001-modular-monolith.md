# ADR-0001: TypeScript modular monolith

## Status

Accepted in [plan.md](../../plan.md#architecture-and-tooling); recorded 2026-11-05. Workspace, connectivity, domain schema, migrations and seed are implemented. Business API modules remain planned.

## Context

The take-home asks for one end-to-end slice under a four-to-five-hour timebox. It mandates TypeScript, React and PostgreSQL, while allowing backend-framework and ORM choices. The brief names NestJS, Fastify and Express as examples, and Vite or Next.js for React.

Those are permitted alternatives, not evidence of a completed comparative evaluation. The plan selects NestJS, Vite and Drizzle; it does not record a detailed framework/ORM comparison.

## Decision

Use pnpm/Turbo with `apps/api` (NestJS), `apps/web` (React/Vite) and `packages/contracts` (wire types only). Access PostgreSQL through Drizzle/node-postgres; version the domain schema with generated SQL migrations in `apps/api/drizzle`.

## Consequences

### Easier

- One workspace coordinates the API, UI and shared wire contracts.
- The planned modular monolith keeps the requested slice within one backend.

### Harder

- Shared wire types still require independent runtime validation.
- Build ordering must produce contracts before dependent applications.
- ORM selection does not implement audit, retention or concurrency policies automatically.

<!-- TODO: verify — record the original comparative rationale for Drizzle versus other persistence tools before writing the required DECISIONS.md section. -->

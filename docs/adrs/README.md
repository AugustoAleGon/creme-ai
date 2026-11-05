# Architecture decision records

Short records of decisions already present in the plan. Status distinguishes selected design from delivered behavior; these docs do not authorize further implementation.

## Index

- [ADR-0001: Modular monolith](adr-0001-modular-monolith.md) — implemented workspace, API and readiness board.
- [ADR-0002: Order-level locking](adr-0002-order-locking.md) — implemented locking and real-PostgreSQL concurrency tests.
- [ADR template](adr-template.md) — starting point for future decisions.

## Maintenance

Record meaningful trade-offs, not every reversible implementation detail. Use `adr-NNNN-short-slug.md` and keep each record under one page. Explain context, alternatives, decision and consequences. Mark an old decision superseded rather than deleting its history.

The take-home [DECISIONS.md](../../DECISIONS.md) addresses the required sections and written questions; these ADRs are supporting context, not its replacement.

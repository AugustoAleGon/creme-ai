# Architecture decision records

Short records of decisions already present in the plan. Status distinguishes selected design from delivered behavior; these docs do not authorize further implementation.

## Index

- [ADR-0001: Modular monolith](adr-0001-modular-monolith.md) — selected stack; workspace implemented, domain deferred.
- [ADR-0002: Order-level locking](adr-0002-order-locking.md) — selected concurrency design; not implemented.
- [ADR template](adr-template.md) — starting point for future decisions.

## Maintenance

Record meaningful trade-offs, not every reversible implementation detail. Use `adr-NNNN-short-slug.md` and keep each record under one page. Explain context, alternatives, decision and consequences. Mark an old decision superseded rather than deleting its history.

The eventual take-home `DECISIONS.md` must still address every required section and written question; these ADRs are supporting context, not its replacement.

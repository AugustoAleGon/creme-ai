# ADR-0002: Serialize readiness-changing writes per job order

## Status

Accepted design in [plan.md](../../plan.md#readiness-and-scheduling); recorded 2026-11-05. Implemented for document and operations writes, including appointment locking, shared readiness evaluation and capacity checks. HTTP tests exercise concurrent booking and cross-appointment duplicate prevention. Readiness GET also locks the order to keep its multi-query snapshot coherent.

## Context

R9 requires a fresh server-side readiness check at booking. R10 requires safe capacity and duplicate handling during concurrent requests. The plan explicitly trades same-order throughput for simpler correctness.

More granular concurrency control is an alternative with greater coordination complexity; DECISIONS.md compares the chosen protocol with serializable transactions and finer-grained locks.

## Decision

Use a READ COMMITTED transaction. Every readiness-affecting write locks the job-order row first. Booking then locks the appointment, rechecks gates, duplicates and capacity, and writes memberships and audit effects atomically.

Reuse the same readiness evaluator for the board and scheduling. Domain refusals allow partial batch success; infrastructure failures roll back the transaction.

## Consequences

### Easier

- A common per-order lock protocol coordinates readiness and booking writes.
- One evaluator reduces divergence between displayed readiness and booking rules.

### Harder

- Writes for one order serialize, limiting same-order throughput.
- Every readiness writer must obey the protocol; appointment locking alone is insufficient.
- Separate-connection integration tests cover last-seat and cross-appointment races; future writers must preserve these checks.

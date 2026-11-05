# ADR-0002: Serialize readiness-changing writes per job order

## Status

Accepted design in [plan.md](../../plan.md#readiness-and-scheduling); recorded 2026-11-05. Not implemented or concurrency-tested.

## Context

R9 requires a fresh server-side readiness check at booking. R10 requires safe capacity and duplicate handling during concurrent requests. The plan explicitly trades same-order throughput for simpler correctness.

More granular concurrency control is an alternative with greater coordination complexity; the source plan does not document a detailed comparison of isolation strategies.

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
- Separate-connection integration tests are still required to prove the implementation.

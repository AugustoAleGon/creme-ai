# Implementation decisions

This local slice implements the six business endpoints and one readiness/booking board. It deliberately excludes production authentication, real uploads and deployment. The [task log](odd/tasks/worker-operations.md) records observed verification, limitations and review history; [API details](docs/api-operations.md) describe the operations endpoints.

## 1. Data model and stack

A worker is a persistent identity; an assignment links that worker to a canonical external job-order ID. The order table is a case-system stub, not a copied case. Separate document versions, QC reviews, acceptances and appointment memberships preserve evidence over time. The 17 tables include technical submission receipts; the [data model](docs/data-model.md) lists their constraints.

NestJS supplies modules and a testable application boundary; React/Vite serves one screen without server rendering. Shared contracts contain wire types, not database entities. Runtime validation remains separate from TypeScript types.

Drizzle was selected for typed SQL-shaped access and inspectable SQL migrations. Explicit locks, partial indexes and composite foreign keys remain visible. Compared with plain `pg`, typed query construction reduces manual row typing but does not replace SQL knowledge or boundary validation. Services own transactions, rather than hiding them in a generic repository. No comparative benchmark or inability of competing ORMs is claimed.

| Rule | Database guarantee | Application responsibility |
|---|---|---|
| R1 | Worker/user uniqueness, one assignment per worker/order, canonical order key and foreign keys | Treat the case system as order owner |
| R2 | Noncascading foreign keys and explicit history/status columns | No hard-delete routes; immutable submission payloads and final reviews. Direct SQL is not prohibited from all edits/deletes |
| R3 | Audit actor references and required event fields | Append audit with every business mutation in its transaction; no database append-only trigger |
| R4 | QC is a separate row, at most one final review per version | No review means pending; only approved active versions satisfy QC |
| R5 | Unique `(user_id, client_submission_id)` receipt | Normalize/compare requests and replay the stored original result |
| R6 | Unique positive version per assignment/type | Select highest submitted approved version; preserve it during conflicting pending uploads |
| R7 | One final review; one open correction per assignment/type | Reviewer differs from submitter/capturer; route correction to owning capturist; fresh approval resolves corrections |
| R8 | Required-document and same-order relationship constraints | Evaluate all four gates, including current terms and active-version QC |
| R9 | Membership and audit share a transaction | Recheck server-side; return partial business refusals without changing refused workers' history |
| R10 | Positive capacity; one active membership per assignment; same-order membership | Lock order then appointment, count occupied seats, enforce capacity |
| R11 | Historical acceptances and memberships remain separate | Current terms affect readiness, never silently remove an existing booking |
| R12 | Valid roles and actor/branch relationships | Fail-closed user, role, branch and ownership checks; no database RLS |

## 2. Idempotency

After input validation, the API authorizes the caller before replay lookup, locks the order and claims the receipt with conflict-safe insertion. It stores the normalized request, original HTTP result and created version in the same transaction as tasks and audit. An identical replay returns that original 201 result, even if QC subsequently changed. A changed request under the same key returns 409. Neither path appends history.

Simultaneous claims of the same user/key serialize on the unique receipt, including assignments on different orders. Under READ COMMITTED, the next query sees the winner's committed receipt. An audit failure rolls back the version and receipt, so a later retry can succeed. Normalization trims values/file references and ignores JSON field order; it preserves field names and opaque IDs. This is submission idempotency, not a general idempotency layer for every endpoint.

## 3. Scheduling under concurrency

A READ COMMITTED transaction locks the order first, then the appointment. It reruns the shared readiness evaluator, checks existing memberships and capacity, and writes eligible memberships plus audit atomically. All implemented readiness-changing writes use the same order lock; readiness GET also locks it to keep its multi-query snapshot coherent. Queries on the single transaction connection run sequentially.

The common order lock covers two appointments competing for the same assignment, while the unique active-membership index is a second defense. Capacity is an application check under locks, not a SQL CHECK over other rows. Duplicate input IDs collapse in request order. Already booked in the same appointment returns `already_scheduled`; another appointment returns a refusal. Business refusals permit partial success; infrastructure failures roll back the whole request.

This coarse lock is easy to reason about but limits same-order throughput. Serializable transactions would require a deliberate retry policy. Finer worker/appointment locks could allow more parallelism but require a consistent multi-resource lock order and coordination with document/terms writes. Neither alternative was needed for the timeboxed slice.

## 4. Permissions

Shared caller and assignment checks enforce access within API transactions. Workers can submit or accept only for themselves; QC and coordinators stay within their branch. QC additionally rejects the submitter and capturer. Acceptance checks the role-specific method before returning an existing record, so replay cannot bypass authorization.

`X-User-Id` is a local demo selector, **not authentication**. Missing, unknown, inactive or role-ineligible callers receive 403. Missing/inactive/inaccessible records receive 404 to avoid disclosing existence. Invalid bodies return 400; conflicting keys/finalized QC return 409. Nest's `{statusCode, message, error}` envelope is used; unexpected failures return sanitized 500 responses. Validation precedes authorization, so malformed requests can return 400 first.

## 5. Assumptions

- Duplicate prevention is per worker/order assignment, not across a worker's lifetime. Existing bookings survive later terms changes, even if readiness now fails.
- Bruno's non-passport documents are approved; otherwise approving his passport alone could not make him ready in scenario 2.
- "Most recent approved" means highest submission version, not latest review timestamp. A pending replacement does not displace approval. File-reference changes alone are not field conflicts.
- Workers accept using `in_app`; coordinators record `verbal` acceptance on behalf of the assigned worker. Old-version acceptance is valid historical evidence, not current readiness. No current terms fails closed.
- Employer evidence/date changes supersede the old decision; exact repeats do nothing. Acceptance repeats preserve the original method. Repeated final QC returns 409 rather than silently overwriting evidence.
- The documents gate checks presence; QC checks approval separately. Resubmission does not clear an open correction task; fresh approval resolves it. Tasks are deduplicated by assignment/type.
- Inaccessible batch members receive generic refusal reasons. Eligible assignments consume seats in first-occurrence request order.
- The seed is an initializer, not a reset: repeated execution preserves user changes and history. A fresh demo needs a separate empty database.

## 6. What was cut and what comes next

No stretch goals were added. Missing pieces include authenticated identity, real uploads, terms publication/cancellation, database-enforced audit immutability, pagination, telemetry, timeout/retry policies, CI and deployment. Historical statuses exist without an archive UI. Future terms publication must ensure exactly one current version under the order lock.

The board is fixed to the seeded order and two demo coordinators. It fetches whole-order history for readiness; coarse locking and growing document history are the first scaling concerns. Boundary validation checks shapes, not jurisdiction-specific document rules. No production security certification, load benchmark or mobile visual QA is claimed.

The board confirms only server-returned outcomes. Failed refreshes retain results without inventing booking success. If the POST response is lost, the UI admits that the outcome is unconfirmed and asks for a readiness check. Next priorities are authenticated identity, measured query/lock profiling, stronger database audit protections and broader failure-path UX. The actual recording and private repository sharing remain delivery actions, not code features.

## 7. AI usage log

Codex assisted with repository exploration, implementation, tests and documentation. Bounded workers implemented API/UI in parallel; independent checks used external snapshots and real PostgreSQL. Gentle AI provided immutable review, Engram retained decisions, and browser automation checked the running board. This AI-assisted write-up needs the submitting developer's review.

Two corrections demonstrate why generated code was not accepted on trust:

1. The initial acceptance implementation missed the worker `in_app` restriction. A test reproduced verbal worker acceptance returning 200; the guard was added before replay lookup, and the request then returned 403 without history changes.
2. The UI treated retained readiness data as proof of a successful booking. Review found that failed POST followed by failed refresh could say "Booking recorded." A regression reproduced it; passing the correct message context fixed repeated retries while preserving confirmed results.

Verification used HTTP responses, persisted effects, refusal/replay hashes, separate-connection races, baseline comparisons and React interactions. Code review did not replace tests; observed commands/results are in the task log.

## Written questions

### 1. Offline actions and terms v3

Treat each queued action as an independently identified command, not a snapshot that overwrites server state. The passport upload uses its submission key, preserves approved evidence and enters pending QC. Acceptance records the exact terms version the worker actually saw; it must not be silently upgraded to v3. Historical acceptance can be stored while readiness requires explicit acceptance of current v3. Arrival confirmation needs its own defined event contract, stable idempotency key, assignment authorization and timestamps separating observed time from receipt time; this slice does not implement it. Return a result per action so one refusal does not discard unrelated valid work. The phone shows synced, pending review, refused or needs reconfirmation distinctly and presents v3 for informed acceptance. "Pending Sync" remains local until the server acknowledges the action.

### 2. Retried order-release event and team coordination

Agree a versioned event contract with the case-system team: stable event ID, canonical order ID, release revision, actor/source and occurrence time. Their outbox commits the event with the release; our inbox deduplicates its delivery. In one operations transaction, authorize the source, record the receipt and create tasks with a unique business key such as order, release revision and task type. Acknowledge only after commit. Duplicate deliveries return the prior outcome; retries cannot create duplicate tasks. Define ordering, cancellation and replay policy before rollout, including what a newer release supersedes. Share contract fixtures, compatibility tests, ownership, monitoring and a retry/dead-letter runbook. Roll out the tolerant consumer before enabling the producer, then reconcile an agreed sample of releases. This integration is proposed, not implemented in the take-home.

### 3. Three hundred workers

The first likely bottlenecks are whole-order history loading and the shared order lock, including readiness reads. The board also renders all workers at once. I would measure query duration, rows transferred, lock wait and response size before changing correctness controls. Query only the active versions required for gates, add plan-verified indexes and paginate or virtualize the board. Evaluate a read model for display while keeping booking revalidation authoritative. If lock contention is material, redesign a consistent assignment/appointment locking protocol or use serializable transactions with bounded retries; every readiness writer must participate. Do not remove the order lock merely because the UI looks slow. Keep the existing race and refusal-history tests, add representative 300-worker history fixtures, and benchmark competing coordinators before accepting the change.

### 4. Shared phone number

A phone number is a contact channel, not a unique worker identity. Keep separate persistent worker IDs and model shared contact relationships explicitly. An OTP proves access to that phone at that moment; it does not prove which family member is acting. After contact verification, use a separate identity-verification or account-selection flow that does not expose another worker's documents merely to anyone holding the phone. Support assisted enrollment, safe recovery when a number is reassigned, and an explicit delegated-access relationship with consent, scope, expiry and audit. Record both the acting user and represented worker rather than merging their histories. Test shared devices and logout/account switching. The exact additional authentication factor and recovery process should be agreed with the client around accessibility and threat modelling; the demo header is not that solution.

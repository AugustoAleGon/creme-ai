# Implementation decisions

This is a partial write-up through T2. Readiness, scheduling, the board, written answers and recording remain deferred; this is not the final submission.

## Document workflow (R2–R7)

`POST /api/mobile/submissions` accepts `clientSubmissionId`, `rosterAssignmentId`, `documentType`, `fields` and `fileRef`. It returns HTTP 201, including on replay:

```json
{"documentVersionId":"generated-id","version":2,"status":"pending_review","conflict":false}
```

`fields` is a nonempty map of nonempty strings. Values and file references are trimmed; field names and opaque IDs are preserved. Field order does not matter. Unknown top-level properties are rejected rather than silently accepting client-supplied actors. Document-specific formats and file storage are outside this slice. There is no runtime schema dependency in the workspace; small boundary parsers validate these two inputs without adding a library.

### Offline replay and conflicts

A READ COMMITTED transaction authorizes the worker and active assignment, locks its job order, rechecks the assignment, and claims `(userId, clientSubmissionId)` with conflict-safe insertion. A competing receipt claim waits for the first transaction; its next query sees the committed result. The unique key also covers a worker's assignments in different orders.

The canonical request, original response, version and all domain effects commit together. An identical normalized request returns the original result, even after QC changes that version's status. A changed payload using the same key returns 409. Neither path appends domain history. Receipts are technical replay metadata, not separately audited business records.

A submission always creates a new version with no QC row (`pending_review`). Conflict comparison uses the highest-numbered approved version's normalized fields, never just the latest upload. Changing only the file reference is not a field conflict. Approved content is never overwritten; conflicting uploads create one open correction task per assignment/document type, owned by the assignment's capturist. Existing tasks retain their original reason/source rather than being overwritten by retries or later conflicts.

### Independent QC and audit

`POST /api/document-versions/:id/review` takes `decision: approve | reject` and an optional nonempty `reason`; rejection requires a reason. It returns HTTP 200 with `documentVersionId` and `status: approved | rejected`.

Each version gets one final decision. Even a repeated identical review returns 409; QC does not have a client idempotency key. Reviewers cannot be either the submitter or capturer. Rejection opens a deduplicated correction task. Resubmission leaves it open; a fresh approval resolves all open corrections for that assignment/type, including when versions are reviewed out of submission order. Active-version precedence still follows submission version numbers, not review timestamps.

Both endpoints acquire the same job-order lock before writes. Document creation, review creation, task creation and task resolution append audit records in their transaction. Creation records use `field: created`, `oldValue: null` and the created record; resolution records retain the full old/new task, including its resolution timestamp. Actors act for themselves on these endpoints, so `onBehalfOfUserId` is null. Audit failure rolls back all effects, including the receipt. No API update/delete operation exists for document payloads, final reviews or audit rows. Database-enforced append-only triggers remain a deferred stretch goal.

## Permissions (R12)

`X-User-Id` is a demonstration caller selector, **not authentication**. It is unsafe for production without an authenticated identity boundary.

- Missing/unknown/inactive users or missing roles: 403.
- Workers: only their own active assignment and non-archived worker record.
- QC: only the caller's branch, with the independent-review restriction.
- Missing, inactive or inaccessible order/assignment/document: 404 to avoid disclosing record existence.
- Malformed input: 400; reused keys with different content or finalized QC: 409.

Business failures use Nest's `{statusCode, message, error}` envelope. Unexpected infrastructure errors return a sanitized 500; no document payload or database diagnostic is returned. Validation precedes database authorization, so malformed requests may return 400 before caller checks. Authorization always precedes receipt replay. Role/branch administration and archive mutations are not exposed by this API.

## Database versus application

Database constraints enforce foreign keys, required-document membership, unique version numbers, one final review, one open task and unique receipt keys. Application checks enforce caller scope, reviewer independence, normalization, conflict detection and transactional audit. The job-order lock serializes version allocation and QC/task transitions. No schema or dependency changes were needed for T2.

## Remaining decisions and verification

Scheduling uses the planned order-then-appointment lock protocol, but is not implemented or proven yet. T2 HTTP tests use real PostgreSQL and check persisted effects, parallel requests, refusals, replay and rollback. Full readiness assertions await T3's endpoint. Final ORM comparison, full R1–R12 enforcement inventory, scaling answers and AI usage log remain T5 work.

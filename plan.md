# Creme take-home: implementation plan

## Current implementation scope

Initial setup is functionally verified. The current authorized increment is T1b: domain schema, versioned migrations, exact seed data and database-constraint tests. API business features and the readiness board remain deferred. Work directly on `main`; the user waived the review-size/chained-PR rule for this implementation. Do not create commits or publish without an explicit request.

## Architecture and tooling

Build a small modular monolith using TypeScript throughout:

```text
apps/
  api/          NestJS; domain logic, Drizzle schema, migrations, seed
  web/          React + Vite; readiness board
packages/
  contracts/    Shared API request/response types; no database internals
```

- pnpm workspaces and Turborepo coordinate development, builds, lint, typechecking and tests.
- Drizzle with node-postgres persists data in PostgreSQL 16, started through Docker Compose.
- Oxlint handles linting; TypeScript runs as a separate check.
- Nest's TypeScript compiler and Jest/Supertest exercise API behavior against real PostgreSQL.
- Cache builds and static checks, never database tests, migrations or seeds. Development tasks are persistent and uncached.
- Pin mutually compatible stable dependencies; use an injectable database provider with explicit pool shutdown.
- The contracts package shares wire types, not entities or business logic. Types do not replace runtime input validation.

## Data integrity decisions

### Retention and document history

Drizzle is the persistence tool; archival is a domain policy.

- Represent archival, cancellation and supersession explicitly, not with one universal soft-delete filter.
- Document submission payloads are immutable. Store QC decisions separately.
- The active document is the highest submitted version with approval, or the latest submission when none is approved.
- Pending replacements never displace approved versions.
- Compare normalized submitted fields with the active approved version to detect conflicts. A different file reference alone is not a data conflict.
- Preserve history; expose no hard-delete endpoints or cascading deletes.
- Create all tables required by the brief, plus submission receipts. Back rules with foreign keys, status checks, positive capacities and uniqueness constraints. Job-order external IDs remain canonical.

### Retries, QC and audit

- Authorize before checking a replay.
- A submission key is unique by `(userId, clientSubmissionId)`.
- Claim keys with conflict-safe insertion inside the transaction. Persist the canonical request, original response, version, tasks and audit effects atomically.
- Identical replay returns the original response; key reuse with changed content returns 409.
- One final QC decision per version; reviewers cannot review their own captured/submitted version.
- Rejections and conflicts create deduplicated correction tasks for the assignment's owning capturist.
- Fresh approval resolves outstanding correction tasks for that assignment/document type; resubmission alone does not.
- Actual state changes append audit entries in the same transaction. Replays and refusals do not change domain history.

### Readiness and scheduling

Reuse one readiness evaluator for the board and booking.

1. Start a READ COMMITTED transaction.
2. Lock the job-order row first.
3. For booking, lock the appointment next.
4. Re-evaluate readiness, existing bookings and capacity.
5. Insert eligible memberships and audit entries, returning per-assignment refusals.

Every readiness-affecting write must acquire the same job-order lock. This deliberately trades same-order throughput for simpler correctness. Enforce one assignment per worker/order and one active booking per assignment. Business refusals permit partial success; infrastructure failures roll back the transaction.

## API, UI and assumptions

Implement the six required endpoints with runtime validation and consistent error envelopes:

- POST /api/mobile/submissions
- POST /api/document-versions/:id/review
- POST /api/roster-assignments/:id/employer-decision
- POST /api/roster-assignments/:id/acceptance
- GET /api/job-orders/:id/readiness
- POST /api/appointments/:id/schedule

Use 403 for missing/unknown users or insufficient roles; 404 for missing/inaccessible records; 400 for malformed input; 409 for conflicting operations. Enforce branch and worker ownership on the server.

Extend readiness responses with appointment IDs, capacity and remaining seats. Scheduling returns per-worker outcomes and refreshed capacity. The board shows four gates and reasons, appointment and worker selection, inline results, a seeded-user switcher, and loading/empty/error states. Refetch after booking rather than optimistically claiming a seat.

Document these assumptions:

- Duplicate prevention applies within a job order, not across a worker's lifetime.
- Same-appointment repeats return already_scheduled; booking elsewhere in that order is refused.
- Process distinct batch IDs in request order; inaccessible records get generic refusal reasons.
- Old-terms acceptance remains historical evidence without satisfying current readiness.
- Terms changes never automatically cancel existing bookings.
- Bruno's non-passport documents are approved so scenario 2 is internally consistent.
- No archive-management UI, real uploads, authentication, mobile app or stretch goals initially.

## Implementation sequence and budget

Tests accompany behavior, not a final testing phase.

| Target | Deliverable |
|---|---|
| 25 minutes | Workspace, tooling, Compose and runnable API/test harness |
| 45 minutes | Schema, migrations, exact seed and constraints |
| 60 minutes | Permissions, submissions, QC and transactional audit |
| 65 minutes | Employer decisions, acceptance, readiness and concurrent booking |
| 35 minutes | Readiness board and booking feedback |
| 10 minutes | Clean-start smoke test and gap inventory |

Target four hours, reserving the fifth for failures rather than features. At the hard stop, document incomplete scope honestly. Write-up and recording are outside the brief's implementation timebox.

## Acceptance and submission

Run all seven required API integration behaviors against real PostgreSQL, checking responses and persisted effects. Also verify simultaneous submission replay, changed-payload key reuse, approved-document preservation, same-worker booking races across appointments, missing roles/users, cross-worker access, and terms changes preserving existing bookings.

Use an isolated test database with independent fixtures. Concurrency tests require separate connections, not one enclosing test transaction.

Root commands: `pnpm db:up`, `pnpm db:seed` (migrations first), `pnpm dev`, `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build`.

Deliver README, DECISIONS.md with all seven required sections, four written answers of at most 150 words each, and a 5–8-minute recording. Preserve genuine conventional-commit history. Private GitHub publication/sharing requires separate authorization.

## References

- [Drizzle transactions](https://orm.drizzle.team/docs/transactions)
- [PostgreSQL consistency guidance](https://www.postgresql.org/docs/current/applevel-consistency.html)
- [Nest Drizzle documentation](https://docs.nestjs.com/data/drizzle)
- [Turbo task configuration](https://turborepo.dev/docs/crafting-your-repository/configuring-tasks)

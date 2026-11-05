# Worker operations slice

Objective: implement the take-home in plan.md; current increment is database foundation (T1b). Branch: main.
Delivery: exception-ok for generated/cohesive slices; user authorized local reviewable commits on main, no publishing. Runner: Jest/Supertest with real PostgreSQL; React UI checks.

## Specs

### S1

> ## **Overview**
> 
> You will build a thin, end-to-end slice of a worker-operations platform: the backend that accepts document submissions from a worker's phone (including retried offline submissions), routes them through independent QC, decides whether each worker is ready to schedule, and books eligible workers into a consular appointment, plus one staff screen that drives it.
> 
> The slice is modeled on a real client project: a visa-operations platform for seasonal workers. It has an existing case-management system, a new staff operations app, and a native worker app, all sharing one backend and one PostgreSQL database. You would be one of two full-stack developers working alongside a mobile developer.
> 
> **Timebox:** aim for 4 hours, hard stop at 5\. An incomplete slice with honest notes beats a complete one that is untested or unexplained. The write-up and recording do not count toward the timebox.
> 
> **Stack**
> 
> * TypeScript on both ends  
> * Node backend, framework of your choice (NestJS, Fastify, Express, etc.)  
> * PostgreSQL 15+ running via `docker compose`  
> * React for the UI (Vite or Next.js)  
> * ORM or query builder of your choice; say why in DECISIONS.md
> 
> **What to submit**
> 
> 1. A private GitHub repo shared with us. Keep your real commit history; do not squash.  
> 2. A README with one command to start the database, one to seed, one to run the app, one to run tests.  
> 3. `DECISIONS.md` (details below).  
> 4. A 5–8 minute screen recording: a walkthrough of the working slice, then one piece of code you are proud of and one you are least confident in.

### S2

> ## **Domain primer: rules the slice must enforce**
> 
> The platform's job is to keep the record truthful. Each rule below has an ID; reference those IDs in your code comments, tests and DECISIONS.md.
> 
> **Records**
> 
> * **R1 — Canonical records.** A Worker is a persistent identity that outlives any one season. A Roster Assignment is one worker on one job order. Job orders live in the existing case system and are referenced by their external ID (e.g. `JO-2026-0142`), never copied. A stub `job_orders` table holding the ID, branch and current terms version is fine.  
> * **R2 — Nothing is deleted.** Records are cancelled, archived or superseded, never hard-deleted. Document versions are immutable; a resubmission is a new version and prior versions stay in history.  
> * **R3 — Append-only audit.** Every state change writes an audit row: actor, the user they acted on behalf of (nullable), entity, field, old value, new value, timestamp.
> 
> **Submissions and QC**
> 
> * **R4 — Submitted ≠ completed.** A worker's upload enters `pending_review`. Only an independent QC approval makes it count.  
> * **R5 — Offline replay is normal.** The worker app queues actions while offline and may send the same submission several times after reconnecting. Each carries a client-generated `clientSubmissionId`. A replay must return the original result and never create a second version, task or audit entry. ("Pending Sync" is a client-side delivery state; the server never stores it.)  
> * **R6 — Conflicts never overwrite reviewed data.** If a new submission conflicts with an already-approved value (e.g. a different passport number than the approved one), keep the approved version active, store the new one as `pending_review`, and create a correction task. The active version of a document type is its most recent approved version; if none is approved, it is the latest submitted version.  
> * **R7 — Independent QC.** The reviewer must be a different person from whoever submitted or captured that version. A rejection creates a correction task for the capturist who owns the assignment. A resubmission clears prior QC and needs a fresh review.
> 
> **Readiness and scheduling**
> 
> * **R8 — Four hard gates.** A roster assignment is ready only when all four hold:  
>   1. **Employer approval:** a hiring approval is recorded for this assignment.  
>   2. **Worker acceptance:** the worker accepted the job order's *current* terms version. Being reached by phone is not acceptance.  
>   3. **Documents:** every required document type has an active version (see R6).  
>   4. **QC:** the active version of every required document is QC-approved.  
> * **R9 — Recheck at scheduling.** Scheduling re-evaluates the gates server-side at the moment of booking, never trusting what the UI showed. Scheduling a batch is partial: eligible workers are booked, ineligible ones are refused with reasons, and nobody else's history changes.  
> * **R10 — Capacity and duplicates under concurrency.** Two coordinators scheduling at the same time must never exceed an appointment's capacity or book the same worker twice.  
> * **R11 — No silent reset.** A new terms version makes gate 2 fail for assignments that accepted an older version, but existing appointment bookings are not removed automatically.
> 
> **Access**
> 
> * **R12 — Permissions fail closed.** Roles: `capturist`, `qc_reviewer`, `labor_coordinator`, `worker`. Staff act only within their branch. Workers see and act on only their own assignments. An unknown user, missing role or out-of-scope record is denied, enforced on the server.

### S3

> ## **Required scope**
> 
> Build these four parts. Where this brief is silent, make a reasonable call and record it in DECISIONS.md rather than asking.
> 
> ### **1\. Data model (PostgreSQL migrations)**
> 
> At minimum: branches, users and roles, job orders (stub), terms versions, workers, roster assignments, employer decisions, acceptances, required document types, document versions, QC reviews, tasks, appointments, appointment memberships, audit log. Use real migrations, constraints and indexes, not just ORM sync. Database constraints should back up the rules wherever they can.
> 
> ### **2\. API**
> 
> Authentication is out of scope: identify the caller with an `X-User-Id` header and look up their roles and branch. Shapes below are a starting point; adjust them and explain why.
> 
> | Endpoint | Who may call | What it must do |
> | ----- | ----- | ----- |
> | `POST /api/mobile/submissions` | worker (own assignment) | Body: `clientSubmissionId`, `rosterAssignmentId`, `documentType`, `fields` (e.g. `documentNumber`, `expiresOn`), `fileRef` (a string; no real file upload). Creates a `pending_review` version. Idempotent per R5; conflict handling per R6. |
> | `POST /api/document-versions/:id/review` | qc\_reviewer | `decision: approve | reject`, `reason`. Enforces R7. Rejection creates a correction task. |
> | `POST /api/roster-assignments/:id/employer-decision` | labor\_coordinator | Record hiring approval with `evidence: document | verbal` and `decidedOn`. |
> | `POST /api/roster-assignments/:id/acceptance` | labor\_coordinator or the worker | Record acceptance of a specific `termsVersionId` and the `method` (verbal, in\_app). |
> | `GET /api/job-orders/:id/readiness` | labor\_coordinator | Per assignment: each of the four gates, pass or fail, with a human-readable reason. |
> | `POST /api/appointments/:id/schedule` | labor\_coordinator | Body: `rosterAssignmentIds[]`. Enforces R9 and R10. Returns a per-assignment result: `scheduled`, `already_scheduled` or `refused` with reasons. |
> 
> Errors should be consistent and useful: 400 for invalid input, 403 for permission failures, 404 for out-of-scope or missing records (your call, explain it), 409 for conflicts.
> 
> ### **3\. Staff UI: Readiness board**
> 
> One screen for a job order, used by a labor coordinator:
> 
> * A table of roster assignments showing the four gates and, for each failing gate, why it fails  
> * Select workers and schedule them into an appointment, then show each worker's result inline (scheduled, refused and why)  
> * Remaining capacity for the appointment  
> * Sensible loading, empty and error states; no full-page reloads
> 
> A user switcher (to change `X-User-Id`) is fine. Visual polish matters less than clarity: a coordinator should understand at a glance who can go and what is blocking everyone else.
> 
> ### **4\. Automated tests**
> 
> At least these behaviors, against a real Postgres (not mocks):
> 
> 1. Replaying a submission with the same `clientSubmissionId` returns the original result and creates no duplicate version, task or audit row.  
> 2. A reviewer cannot approve a version they captured.  
> 3. A resubmission after rejection resets QC; the worker is not ready until a fresh approval.  
> 4. Accepting an outdated terms version does not satisfy gate 2\.  
> 5. Scheduling a mixed batch books the eligible workers and refuses the rest with reasons.  
> 6. Two concurrent schedule calls cannot exceed capacity or double-book a worker.  
> 7. A coordinator from another branch is denied.

### S4

> ## **Seed data and scenarios**
> 
> Your seed script must create exactly this starting state; we will run these scenarios against it.
> 
> **Setup.** Two branches, Norte and Sur. Job order `JO-2026-0142` belongs to Norte, with terms version v1 (superseded) and v2 (current). Required document types for this order: `passport`, `ds160_confirmation`, `signed_contract`. Appointment `APT-1` (capacity 2\) and `APT-2` (capacity 1), both for this order, both empty.
> 
> **Staff**
> 
> | User ID | Name | Roles | Branch |
> | ----- | ----- | ----- | ----- |
> | `u-pedro` | Pedro | labor\_coordinator | Norte |
> | `u-sofia` | Sofía | labor\_coordinator | Sur |
> | `u-marta` | Marta | capturist | Norte |
> | `u-luis` | Luis | qc\_reviewer | Norte |
> | `u-rosa` | Rosa | capturist, qc\_reviewer | Norte |
> 
> **Workers on JO-2026-0142** (each has a matching worker user, `w-1` to `w-6`; Marta is the owning capturist for all six)
> 
> | Worker | Employer approval | Accepted terms | Documents |
> | ----- | ----- | ----- | ----- |
> | `w-1` Ana López | Approved | v2 | All 3 approved |
> | `w-2` Bruno Díaz | Approved | v2 | All 3 submitted; passport captured by Rosa, still `pending_review` |
> | `w-3` Carla Ruiz | Approved | v1 only | All 3 approved |
> | `w-4` Diego Mora | None | v2 | All 3 approved |
> | `w-5` Elena Soto | Approved | v2 | Passport rejected by Luis, correction task open; others approved |
> | `w-6` Fausto Vega | Approved | v2 | All 3 approved |
> 
> **Scenarios we will run** (your tests may cover these too)
> 
> 1. As `u-pedro`, view readiness: only `w-1` and `w-6` are ready; every other worker shows the specific failing gate.  
> 2. As `u-rosa`, approve Bruno's passport: refused (R7). As `u-luis`, approve it: Bruno becomes ready.  
> 3. As `w-5`, submit a corrected passport twice with the same `clientSubmissionId`: one new version, one result, Elena still not ready until a reviewer approves it.  
> 4. As `w-1`, submit a passport with a different number than her approved one: her approved passport stays active, the new one is `pending_review`, a correction task appears, and she remains ready.  
> 5. As `u-pedro`, schedule `w-1`, `w-3`, `w-4`, `w-6` into `APT-1`: `w-1` and `w-6` booked; `w-3` and `w-4` refused with reasons.  
> 6. Fire two simultaneous requests booking different ready workers into `APT-2`: exactly one succeeds.  
> 7. As `u-sofia`, view or schedule `JO-2026-0142`: denied.  
> 8. As `w-2`, submit for `w-3`'s assignment: denied.

### S5

> ## **DECISIONS.md and written questions**
> 
> We weigh your reasoning as heavily as your code. `DECISIONS.md` should be short and specific: name the trade-off, what you chose, and what you gave up. Aim for 2–4 pages.
> 
> **Required sections**
> 
> 1. **Data model.** The key tables and constraints, and which rules (R1–R12) are enforced in the database versus in application code, and why.  
> 2. **Idempotency.** How a replayed submission is detected, what is stored, and what happens if two replays arrive at the same instant.  
> 3. **Scheduling under concurrency.** How you guarantee R9 and R10: transaction boundaries, isolation level or locks, and why you chose that approach over the alternatives.  
> 4. **Permissions.** Where checks live, how "fail closed" is guaranteed, and your 403-versus-404 choice.  
> 5. **Assumptions.** Every place this brief was ambiguous and how you resolved it.  
> 6. **What you cut.** What is missing or fragile, and what you would do next.  
> 7. **AI usage log.** Which tools you used and for what, one or two places where the AI was wrong or misleading, and how you verified its output.
> 
> **Written questions** (150 words or fewer each; no code needed)
> 
> 1. A worker queues three actions offline over two days: a passport upload, a terms acceptance, and an arrival confirmation. Meanwhile staff publish terms v3. When the phone syncs, what should the server do with each action, and what does the worker see?  
> 2. The "order released" event comes from the existing case system, whose codebase is owned by the client's in-house team. You need it to create intake tasks in the operations app. How do you make it safe to retry, and how do you coordinate the change with another team?  
> 3. A real order has 300 workers split across several coordinators. What in your implementation breaks or slows down first, and what would you change?  
> 4. Two workers in one family share a single phone number. What does that mean for phone-based sign-in and for worker identity, and what would you propose?

### S6

> ## **Stretch goals, AI use and how we evaluate**
> 
> **Stretch goals.** Only after the required scope works and is tested. Pick at most two; a finished stretch is worth less than a solid core.
> 
> * When a new terms version is published, create one deduplicated reconfirmation task per affected assignment (safe to run twice).  
> * Optimistic concurrency on employer decisions: a stale write returns 409\.  
> * Enforce the append-only audit log in the database itself, not just by convention.  
> * Spanish / English toggle on the readiness board (Spanish is the workers' default language; staff use both).  
> * A QC queue screen for reviewers.
> 
> **AI tools are allowed and expected.** We work AI-native. What we care about is judgment: the context you gave the tools, how you verified their output, and whether you understand the result. In the follow-up session we will ask you to explain and change parts of your code live, without AI assistance.
> 
> **How we evaluate**
> 
> * Correctness of the business rules, especially R4–R11  
> * Data integrity under retries and concurrency  
> * Security: server-side, fail-closed permissions  
> * API and schema design that the next developer could extend  
> * A UI that makes readiness obvious to a coordinator  
> * Tests that prove the risky behavior, not just the happy path  
> * Clear, honest reasoning in DECISIONS.md and the recording
> 
> Questions about logistics (access, deadlines) are welcome. Questions about the rules themselves: make a call and document it; that is part of the test.


### S7 — Current authorized increment

> We want to ignore that rule on this implementation and let's focus on the first setup. We are not gonna use branches we are gonna use the same main branch

Acceptance: installable pnpm/Turbo workspace, NestJS and Vite app shells, Drizzle/PostgreSQL connectivity, Compose database, Oxlint, typecheck/build and runnable smoke tests. No domain implementation in this increment.

### S8 — Database foundation increment

> Let's continue with the work
> Yes, Let's do it.

Scope confirmed in conversation: T1b only — schema, migrations, exact seed, and database constraints. The user approved testing migrations, seed data, and constraints directly against isolated PostgreSQL test databases. Keep API behavior and readiness UI deferred; work on main. Later authorization in L10 permits local reviewable commits.

Acceptance: versioned SQL migrations generated from Drizzle; all required domain tables and submission receipts; repeat-safe seed matching S4; constraints backing S2; root migration/seed commands and documentation. Tests must not reset development or shared test data.

## Tasks
- T1 | S1, S7 | inline | functionally verified | Workspace/tooling, app shells, Compose, Drizzle connectivity and smoke tests; commit c14a2b1, native review explicitly declined for this candidate. Risk: item 5 (dependencies/environment).
- T1b | S2–S4, S8 | inline | complete | Commit d0976c24df195dadfffdda439ef5c9f329defe4a. Domain schema, migrations, seed and database-seam tests; independent verification passed and native four-lens review acknowledged with no findings. No writer trigger: one dependent database unit. Risk: items 1, 4, 5 (migrations, repeat-safe seed concurrency, database tooling).
- T2 | S2–S5 | inline | pending | Submissions, QC, permissions and audit with HTTP integration tests; commit pending. Risk: items 2, 4 (access/concurrency).
- T3 | S2–S5 | inline | pending | Acceptance, employer decisions, readiness and scheduling with concurrency tests; commit pending. Risk: items 2, 4 (access/concurrency).
- T4 | S3–S5 | delegated if parallel API/frontend surfaces are ready | pending | Readiness board with component tests; commit pending.
- T5 | S1–S6 | inline plus independent verifier | pending | Final acceptance checks and submission documentation; commit pending.

## Log
### L4 — Setup-only scope and main branch (2026-11-05)
> We want to ignore that rule on this implementation and let's focus on the first setup. We are not gonna use branches we are gonna use the same main branch

- Work directly on main. Size-based splitting/chain rules are waived for this implementation; no automatic commits.
- Complete only T1 now. Other tasks remain deferred until requested.
- T1 uses inline implementation: one coherent setup behavior, no independent parallel writer units. An independent verifier follows own checks because dependency/environment changes are Risk item 5.

### L1 — Original request
> Let's review this '/Users/augustoalegon/Downloads/Creme Take-Home — Augusto.md'  make an analysis and review what the necessary steps to complete this.
>
> We want to use a monorepo structure using turbo with pnpm vite and also nestjs. For the ORM we want to make an analysis of which ORM is better for handling the case of archived.
> We want to use also oxlint.
> Ask me any question is something is not clear and let's start from there

### L2 — Confirmed scope
> Take-home timebox (Recommended)
> I have used Prisma DB and Sequialize. Let's use Drizzle for this case
> Let's write down the plan and start the implementation

### L3 — Initial evidence
- Workspace was empty and not a Git repository. Initialized feature branch; no remote configured.
- Node 22.23.4, pnpm 10.19.0, Compose 5.3.1 available. Docker daemon initially unavailable; requested Docker Desktop startup locally.
- Save plan first. No existing behavior to compare against a previous application baseline.
- Agreed test seam: six HTTP endpoints with real PostgreSQL and persisted effects, plus readiness-board interactions.
- Stable registry versions observed: drizzle-orm 0.45.4, drizzle-kit 0.31.11, NestJS 12.3.3, Vite 8.3.6. Verify package compatibility during installation.
- RDD switch is on globally; high-risk candidate reviews require separate native consent. No remote publication authorized.

### L5 — Initial setup verification (2026-11-05)
- Implemented workspace, two apps, shared health-response contract, local PostgreSQL 16 Compose, Drizzle connectivity, Oxlint and pinned dependency lockfile. No domain schema or seed introduced.
- RED: API health returned 404 before implementation; unavailable database returned 500 before 503 handling. Web connection test failed before the status UI existed.
- GREEN: 2 API integration tests against real PostgreSQL and 2 web component tests passed.
- Own checks: frozen-lockfile install, lint, typecheck, build and root test command passed. Docker database is healthy; development and test databases are separate.
- Optional host Watchman crashed due to missing libfmt.11; disabled optional Jest Watchman integration rather than modifying host tooling. Jest VM-module warning and upstream package deprecations documented.
- Initial repository has no baseline commit/application behavior; differential baseline testing is not applicable. No commits created.
- Independent verification pending for Risk item 5 (dependencies/environment). Native review remains pending; switch was not changed.

### L6 — Independent verification and correction
- Fresh external scratch: frozen offline install; 11 Turbo tasks and 4 initial tests passed under Node 22.23.4. Direct and proxied health endpoints returned 200; original source hashes unchanged.
- Verifier reproduced one blocker: idle pg Pool error terminated API after database connection loss.
- One bounded correction added sanitized pool error handling and a real-PostgreSQL TCP-proxy regression. Observed RED (unhandled error), then GREEN (3 API tests). Lint, typecheck and build pass.
- Independent targeted recheck: idle-loss test passed (2 unrelated tests intentionally skipped), original external proxy probe confirmed API remained alive. S7 and S1 setup subset pass; no other domain specs claimed.
- No commits or remote operations performed. Domain schema, seed and business rules remain deferred at user request.

### L7 — Database foundation authorized (2026-11-05)
> Let's continue with the work

Assistant scoped continuation to T1b (schema, migrations, exact seed), main, no commits. Asked to test directly at the isolated PostgreSQL database seam rather than unavailable business HTTP endpoints.

> Yes, Let's do it.

- Reconciled local log and Engram mirror through L6. Initial setup remains verified, not reimplemented.
- Inline route: schema, migration, seed and tests form one dependent behavior; no parallel writer reason. Existing docs-only HEAD does not contain setup; preserve an external pre-change snapshot for differential checks.
- Test runner: compiled Jest + real PostgreSQL; create uniquely named disposable databases from TEST_DATABASE_URL, never reset the development or shared test database.
- Plan: migration/constraint RED→GREEN, then exact seed/replay RED→GREEN, then independent migration verification. Existing health and web tests remain unchanged.
- Forecast: approximately 800 authored lines plus generated SQL/snapshot. Existing exception-ok size waiver applies. No commits or publication.

### L8 — T1b implementation and own checks (2026-11-05)
- Added 17-table Drizzle schema and generated SQL migration/journal/snapshot. Current terms use a partial unique index, avoiding circular order/version foreign keys. Composite foreign keys preserve same-order acceptance and booking. Application-only rules are explicitly documented.
- Added migration/seed CLI and root commands. Seed is serialized by an advisory lock, transactional with bootstrap audit, repeat-safe by marker and refuses unrecognized nonempty data. No reset command or destructive development data operation.
- Migration RED: public CLI missing (exit 1); GREEN: applies once, replays without changing a sentinel. Seed RED: command refused before implementation; GREEN: exact S4 fixtures, including Bruno's two approved non-passport documents.
- Subsequent safety/constraint coverage: concurrent first seed, replay after user edits, late failure rollback, nonempty refusal, unsupported option refusal, and 26 rejected SQL cases with unchanged data snapshots. Historical bookings and cross-order worker identity remain representable.
- Own checks passed: root lint, typecheck, build and test (8 database tests + 3 API smoke tests + 2 web tests). Migration regeneration reports no changes. Expected Jest VM-module warning remains.
- Schema/constraint assertions were added after the initial schema tracer test; do not claim a separate observed RED for each constraint.
- Documentation records guarantees versus deferred API behavior. No API feature or development seed operation was performed. No commits created.
- Independent verifier pending for Risk items 1/4/5; native assessment/review pending after functional verification.

### L9 — Independent T1b verification (2026-11-05)
- Fresh scratch under Node 22.23.4: lint, typecheck, build and all 13 tests passed. Regenerating migrations produced no changes and preserved hashes.
- Independent root-command probe: migrate then seed succeeded on a new random test database; replay preserved the complete data SHA-256 after user changes; unsupported --reset failed without changing data. All worker/user/role matches verified.
- Baseline and candidate health suites each passed 3/3; existing API runtime source is unchanged. Pre-change application baseline was an external snapshot because HEAD 542f903 contains only context docs.
- Applicable S8 and database subsets of S2/S3/S4 passed; no blockers. Corrected advisory stale migration wording in ADR-0001 and read back the two changed passages.
- Parent spot check repeated root pnpm test: all 13 passed. No development data resets or remote operations. Verifier-owned test databases removed by teardown.
- Functional verification complete; native review consent/assessment is a separate pending step. API/UI and final submission deliverables remain deferred.

### L10 — Smaller local commits authorized (2026-11-05)
> 1

- User granted review of the combined candidate. Exact native START stopped with lens_context_budget_exceeded before creating authority. No review was performed; unchanged retries cannot succeed.

> Yes. Let's do smaller commit and runs

- Local Conventional Commits on main are now authorized. No new branch, push, pull request or publication.
- One cohesive slicing pass: C1 runnable workspace/API/web setup, its smoke tests and setup docs; C2 database foundation, migration artifacts, seed, database tests and corresponding docs. Installed skills and their registry/lock files remain outside these application commits.
- Keep generated lockfile and migration snapshot intact, alongside the manifests/schema they describe. Do not split generated artifacts artificially or shrink code to meet a line target.
- Check each exact staged/committed slice independently. Initial review boundary: 542f903. Risk C1: item 5 (dependencies/environment); C2: items 1/4/5 (migrations, serialized seed, database tooling).
- Existing independent verification stands for unchanged behavior. Native review is additional, candidate-scoped, and requires its returned consent when applicable.

### L11 — First local review slice (2026-11-05)
- C1 committed on main as c14a2b15f31f45919076d057205efc9487991bd9: feat: bootstrap runnable application workspace.
- 35 files, 6,934 additions; 6,205 lines are the generated lockfile, kept intact with matching manifests. Remaining 729 authored lines form the runnable setup and its docs/tests; prior size exception remains applicable.
- Exact staged snapshot independently passed offline frozen install, lint, typecheck, build and 5 tests (3 API health, 2 web). Source/lock hashes unchanged. Parent repeated lint successfully.
- Database source, migration artifacts, corresponding tests/docs/scripts remain in the worktree for C2. No original working content was overwritten: partial staging isolated setup scripts/docs.
- Native committed-range assessment passed as high risk after explicitly excluding all untracked work. Review range is 542f903..c14a2b1, not the working tree. Native consent is pending for lineage review-3e80c8e6166b8599; no approval exists. C2 remains uncommitted until C1 review is resolved.

### L12 — Setup-slice native review limit (2026-11-05)
> Granted

- Ran the exact C1 consent invocation once. START stopped with lens_context_budget_exceeded, mutation_outcome not_started, before any reviewer or authority was created.
- The one cohesive slicing pass did not resolve the native context limit. C1 contains the intact 6,205-line generated lockfile. Do not blindly retry, truncate review evidence, split generated files artificially or rewrite history automatically.
- C1's five setup tests and independent install/build/static verification still stand; no native approval is claimed. C2 remains preserved and uncommitted.
- Needs user decision: skip this C1 candidate review only and continue the authorized C2 commit, or retain the stop. No mode changes or further lifecycle commands performed.

### L13 — Setup review declined; database slice prepared (2026-11-05)
> Yes. Let's skip it

- Executed the exact C1 candidate-scoped decline invocation once; validated action=declined, consent=declined_this_candidate and the exact setup target identity. Re-entered native STATUS, then did not restart the explicitly declined candidate.
- Global review mode remains on; no clone/global preference was changed. C1 is functionally verified, not natively approved.
- Next delivery/review boundary is c14a2b15f31f45919076d057205efc9487991bd9 (C1 declined, not reviewed). C2 contains only database foundation plus its corresponding tests, commands and docs; setup is excluded from C2's committed range.
- C2 commit message: feat(db): add versioned schema and repeat-safe seed. Existing independent database verification remains applicable: source behavior is unchanged from L9. Final root tests are rerun before committing.
- Final precommit root test run passed all 13 tests. The full whitespace diagnostic flags 103 inherited trailing-space lines, all inside the verbatim brief blockquotes (including Markdown hard breaks); preserved as quoted requirements. Whitespace check passes for all other staged files. No code checks failed.

### L14 — Database foundation review completed (2026-11-05)
> granted

- C2 is d0976c24df195dadfffdda439ef5c9f329defe4a, feat(db): add versioned schema and repeat-safe seed. Its committed review range excludes C1, which remains explicitly unreviewed.
- Native risk, resilience, readability and reliability reviewers inspected the immutable C2 patches concurrently. All four reported no findings; no correction was needed. These static reviews do not replace the separately executed 13 passing tests and independent functional verification.
- The final capture approved C2. Its exact acknowledgement completed with action=acknowledged and authority=burned for lineage review-eb635bf06510d154. The native lifecycle is closed; no outstanding review or correction remains for this candidate.
- T1b is complete. T2–T5 remain pending and outside this increment. Review mode remains on; nothing was pushed or published.
- This closure entry changes progress metadata only. Structural readback and whitespace checks cover the documentation-only follow-up; no runtime code changed after verification.

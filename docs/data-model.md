# Data model

## Implemented database foundation

The 17-table Drizzle schema is in `apps/api/src/database/schema.ts`. The generated SQL migration, journal and snapshot live in `apps/api/drizzle`. Run `pnpm db:generate` after a schema change, review the SQL, then use `pnpm db:migrate` to apply it. Do not use schema synchronization.

`pnpm db:seed` applies migrations first and initializes the exact take-home fixtures in one transaction. It never resets existing data. All six business endpoints and their runtime checks are implemented; see DECISIONS.md for the database/application enforcement boundary.

## Tables and structural guarantees

| Tables | Relationships and database constraints |
|---|---|
| `branches`, `users`, `user_roles` | Branch references; unique role per user; roles restricted to the four brief values. Worker users have no staff branch. |
| `job_orders`, `terms_versions` | Canonical external order ID; unique positive version per order; at most one `current` terms row per order. |
| `workers`, `roster_assignments` | One user per worker; one assignment per worker/order, not one lifetime assignment. Explicit archival/cancellation fields retain history. |
| `employer_decisions` | Approval/rejection, evidence, date and actor; at most one nonsuperseded decision per assignment. |
| `acceptances` | One record per assignment/terms pair; composite foreign keys prevent accepting another order's terms. Older acceptances remain historical. |
| `required_document_types` | Unique order/document type; passport, DS-160 confirmation and signed contract. |
| `document_versions` | Unique positive version per assignment/type; JSON object fields and nonblank file reference; assignment and requirement belong to the same order. |
| `qc_reviews` | At most one final review per version; approval/rejection enum; nonblank rejection reason. No review represents `pending_review`. |
| `tasks` | Correction task owner and source version; source must match the assignment/type; at most one open correction per assignment/type. |
| `appointments`, `appointment_memberships` | Positive capacity; same-order membership enforced by composite foreign keys; at most one scheduled membership per assignment, while cancelled history remains. |
| `audit_log` | Actor and optional represented user references; entity, field, old/new values and timestamp; entity-history index. |
| `submission_receipts` | Primary key `(user_id, client_submission_id)`; canonical JSON request, original response and version reference. |

All foreign keys use noncascading deletion behavior. Referenced rows cannot be deleted while dependents exist. This is not a general database-level ban on every UPDATE or DELETE.

## Decisions and trade-offs

- **Current terms live on the terms version.** A partial unique index identifies at most one current version per order. This avoids a circular foreign key between orders and versions. Publishing terms must later ensure at least one current version inside the order-locked transaction; the database index alone does not prove that.
- **Submissions and reviews stay separate.** Submission payloads contain no mutable QC status. A missing review is pending; approval/rejection comes from the independent review row. Selecting the active version and preventing payload edits remain application rules.
- **History gets explicit state.** Assignments and appointments have lifecycle status; decisions have supersession timestamps; memberships can be cancelled; correction tasks can be resolved. There is no universal soft-delete filter or delete endpoint.
- **Receipts can be claimed before completion.** Response/version fields are nullable so the later submission transaction can claim the unique key, create its effects and fill the result before commit. Application code must prevent committing an unfinished receipt.
- **The seed is bootstrap, not simulated API traffic.** Audit entries use `field = seed` and Marta as the fixture actor; a final marker is written in the same transaction. This distinguishes fixture creation from future user actions without inventing an extra staff user.
- **Seed replay preserves rather than repairs.** The marker makes repeat runs no-ops, even after user edits. Nonempty domain data without the marker is refused. A session advisory lock serializes database CLI processes; one transaction rolls back all fixture and audit writes on failure. There is no reset mode.

## Seed contract

The seed contains Norte/Sur, five staff users with the specified roles, six matching worker users, six assignments owned by Marta, `JO-2026-0142`, superseded v1/current v2, three required document types and empty `APT-1`/`APT-2` with capacities 2/1.

- Ana and Fausto: all four gate inputs satisfied.
- Bruno: Rosa captured his pending passport; the other documents are approved, as agreed in `plan.md`.
- Carla: accepted only v1.
- Diego: no employer decision.
- Elena: passport rejected by Luis; one open correction task for Marta.

Fixture dates, document numbers, file references and terms text are illustrative, not real personal records. The seed creates 18 document versions, 17 reviews and 93 bootstrap audit entries, including its completion marker.

## Application guarantees and remaining scope

| Rules | Current boundary |
|---|---|
| R2/R3 | Document endpoints preserve immutable payloads and final reviews, expose no deletes, and audit state changes transactionally. Database-level audit triggers are an optional stretch, not implemented. |
| R4–R7 | Document endpoints implement independent QC, approved-version conflict comparison, replay responses and correction routing/resolution. The operations readiness evaluator preserves approved-version precedence. |
| R8/R9/R11 | Implemented shared readiness evaluator, current-terms gate and server-side booking recheck. Historical acceptances/bookings remain intact across terms changes. |
| R10 | Implemented order-then-appointment locks and capacity recheck. The unique booking index prevents duplicate active assignments, not over-capacity appointments by itself. |
| R12 | All business endpoints implement fail-closed caller, role, branch and worker-ownership checks. No PostgreSQL RLS or production authentication is claimed. |

Database-seam tests exercise real CLI migrations, exact fixtures, replay/concurrency, rollback and SQL constraints in isolated local databases. The document and operations HTTP suites separately cover the seven required business behaviors against real PostgreSQL.

## References

- [Drizzle migration workflow](https://orm.drizzle.team/docs/migrations)
- [Database commands](../README.md#commands)
- [Scheduling lock protocol](adrs/adr-0002-order-locking.md)
- [Original requirements and seed scenarios](../odd/tasks/worker-operations.md)

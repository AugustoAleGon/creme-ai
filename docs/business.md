# Business context

## Product and scope

Creme Operations is a take-home slice of a seasonal-worker visa-operations platform. Workers submit documents, independent reviewers check them, and labor coordinators book eligible roster assignments into consular appointments.

The current repository contains the development workspace and health-check path only. The workflow below is required future behavior, not a claim of implementation.

## Ecosystem and actors

The brief describes an existing case-management system, a staff operations app and a native worker app sharing one backend and PostgreSQL database. The take-home implements backend endpoints and one coordinator screen, not the mobile app or case system.

- Workers submit documents and accept terms for their own assignments.
- Capturists own assignments and receive correction tasks.
- QC reviewers approve or reject documents independently of their capturist/submitter.
- Labor coordinators record employer decisions, inspect readiness and schedule workers within their branch.

## Business rules

| Rules | Required behavior |
|---|---|
| R1 | Workers persist across seasons; roster assignments connect workers to externally identified job orders. |
| R2–R3 | Preserve history; immutable document submissions and append-only audit accompany state changes. |
| R4–R5 | Submission is not approval; offline replay returns the original result without duplicate effects. |
| R6–R7 | Pending replacements do not displace approved documents; QC must be independent and fresh for each version. |
| R8 | Readiness requires employer approval, current-terms acceptance, required documents and approval of each active document. |
| R9–R10 | Booking rechecks readiness, returns partial batch results and protects capacity and uniqueness under concurrency. |
| R11 | New terms invalidate old acceptance for readiness, but never silently remove existing bookings. |
| R12 | Server-side permissions fail closed by role, branch and worker ownership. |

Use the exact rules and seed scenarios in [task specs S2–S4](../odd/tasks/worker-operations.md), reproduced from the supplied take-home brief. The agreed interpretation of ambiguous cases lives in [plan.md](../plan.md#api-ui-and-assumptions).

## Delivery constraints

Target four hours; hard stop at five, excluding the written explanation and recording. Prioritize tested core behavior over stretch goals. The eventual submission requires README commands, `DECISIONS.md`, four short written answers and a 5–8-minute recording. The context ADRs do not replace that submission document.

## Who pays

<!-- TODO: verify — the brief names a client project but does not identify the paying customer or commercial model. -->

## Related docs

- [Architecture](architecture.md)
- [Planned data model](data-model.md)

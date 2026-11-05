# Operations API

The operations API records employer approval and worker acceptance, reports assignment readiness, and books eligible assignments. All endpoints use the caller ID in `X-User-Id`; the server resolves active users, roles, worker ownership, and staff branch scope on every request.

## Endpoints

| Method and path | Access | Behavior |
|---|---|---|
| `POST /api/roster-assignments/:id/employer-decision` | Labor coordinator in the order's branch | Records an `approved` decision with `evidence` (`document` or `verbal`) and calendar date `decidedOn` (`YYYY-MM-DD`). A changed decision supersedes, rather than deletes, the prior row. An identical repeat is a no-op. |
| `POST /api/roster-assignments/:id/acceptance` | The assigned worker or a labor coordinator in the order's branch | Records `termsVersionId` and method (`in_app` or `verbal`). Workers may record in-app acceptance; coordinator-entered acceptance must be verbal and records the worker as the represented user. Repeating the same assignment/terms pair preserves its original evidence. |
| `GET /api/job-orders/:id/readiness` | Labor coordinator in the order's branch | Returns current terms, each assignment's four gates and reasons, current scheduled appointment, and active appointments with capacity remaining. |
| `POST /api/appointments/:id/schedule` | Labor coordinator in the order's branch | Rechecks readiness and capacity and returns a partial per-assignment result (`scheduled`, `already_scheduled`, or `refused`). Duplicate input IDs are collapsed while preserving first-seen order. |

### Example

```http
POST /api/appointments/APT-1/schedule
X-User-Id: u-pedro
Content-Type: application/json

{"rosterAssignmentIds":["RA-1","RA-3","RA-6"]}
```

Each readiness gate contains `passed` and a human-readable `reason`. Missing documents and documents awaiting QC are reported separately. A pending or rejected replacement does not displace a previously approved active version. Accepting old terms remains historical evidence but does not pass the current-terms gate; if no terms are current, that gate fails closed. A terms change does not cancel existing bookings.

## Integrity and access

Readiness-affecting writes use a READ COMMITTED transaction and lock the job order first. Scheduling then locks its appointment, re-evaluates the shared readiness rules, checks active bookings and capacity, and inserts each eligible membership with its audit row in the same transaction. All assignments in one order serialize through the order lock. Business refusals leave history unchanged; infrastructure or audit errors roll back the transaction. A unique active-membership index is the final duplicate guard.

An unknown or inactive caller, or a caller without the required role, receives 403. Missing or out-of-scope orders, appointments, and records receive a generic 404. Inaccessible assignment IDs inside a valid schedule batch receive a generic per-assignment refusal so one ID does not fail the entire batch. Invalid request bodies return 400.

The coordinator's verbal acceptance of behalf of a worker is an implementation assumption because the brief does not specify that actor representation; the audit stores the coordinator as actor and the assigned worker as `onBehalfOfUserId`.

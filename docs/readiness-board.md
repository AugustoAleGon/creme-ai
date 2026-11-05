# Readiness board

The readiness board shows the four server-evaluated gates for each worker assigned to `JO-2026-0142` and lets a labor coordinator request appointment bookings. It is a decision aid, not booking authority: the API rechecks readiness and capacity for every request.

## Use the board

1. Start PostgreSQL, seed the database, and run the API and web app with the commands in the root README.
2. Choose Pedro or Sofía in the coordinator selector. The app defaults to Pedro.
3. Review employer approval, current terms, required documents, and independent QC. Failed gates include the server-provided reason.
4. Select one or more assignments, choose an appointment, and schedule. Mixed selections are allowed so the API can report eligible and refused workers individually.

The board refreshes readiness and appointment capacity after a booking response. Individual outcomes remain visible during that refresh; if refresh fails, the board says the booking was recorded and offers a separate retry. A refused worker must be reviewed against the inline reason and the refreshed server state before another attempt.

## Access and error behavior

The coordinator selector sends the selected seeded user ID in `X-User-Id`. On a switch, the board clears the previous user's records, selections, and results immediately and ignores responses from the prior request. The current interface uses the seeded coordinator identities for local demonstration; it is not production authentication.

Loading and empty assignments have explicit states. A missing or out-of-scope order and a permission failure use one generic access message. Other load failures offer an in-place retry. Scheduling failures are not described as successful bookings; the board preserves only confirmed per-assignment outcomes.

If scheduling fails and a readiness retry also fails, the board keeps the unconfirmed-booking warning. Retrying readiness does not resubmit the booking. Confirmed booking outcomes and their warning remain visible when subsequent readiness retries fail.

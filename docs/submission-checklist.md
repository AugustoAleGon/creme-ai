# Submission checklist

The implementation and local materials are present. This checklist distinguishes repository evidence from delivery actions that have not occurred.

## Repository materials

- [x] Six required business endpoints and the readiness/booking board.
- [x] Versioned PostgreSQL migrations and repeat-safe seed.
- [x] README commands for database, seed, application and tests.
- [x] [DECISIONS.md](../DECISIONS.md): seven required sections and four answers of at most 150 words each.
- [x] [Recording guide](recording-guide.md): proposed 5–8-minute walkthrough.
- [x] Final clean-copy verification: frozen install, lint, typecheck, build and all 39 tests passed; root migrate/seed replay and app startup verified against a disposable database (task log L26).

The real-PostgreSQL suites cover replay, independent QC, fresh review after resubmission, outdated terms, mixed batches, capacity/duplicate races and cross-branch denial. React interaction tests cover board results, refresh failures and caller changes. See [the task log](../odd/tasks/worker-operations.md) for exact observed commands and limitations; do not infer a run solely from this checklist.

## User-owned delivery

- [ ] Review the AI-assisted decisions/answers and be able to explain and change the code without AI.
- [x] Authorized local work-unit commits preserve real history on main; no squash or publication.
- [ ] Record and watch the actual 5–8-minute walkthrough; attach its link to the submission.
- [ ] Confirm the private GitHub destination and intended recipients, then explicitly authorize publication/sharing.
- [ ] Verify access and send the final repository and recording links.

No push, repository sharing, deployment or recording is implied by completed local tests. No stretch goals are needed before delivery.

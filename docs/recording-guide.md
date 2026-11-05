# Record the working slice (5–8 minutes)

This is a suggested walkthrough, not a recording or a claim that one was submitted. Review the code and decisions yourself before recording; choose the code you personally want to explain.

## Prepare

- Follow the root [quick start](../README.md#quick-start). Keep the terminal and browser readable; hide `.env`, credentials and unrelated windows.
- Use a fresh, disposable demo database if the current one has been changed. `pnpm db:seed` preserves existing history and bookings: it does **not** reset the demo. Do not delete the development volume to obtain a fresh state.
- Check that Pedro sees six workers, only Ana and Fausto are ready, and APT-1/APT-2 have two/one remaining seats. If these checks fail, prepare a separate empty database before recording, rather than claiming the changed data is the seed.
- Open the board, the API test files, `operations.service.ts`, `documents.service.ts` and `DECISIONS.md`. Have the final test results visible.

## Suggested seven-minute sequence

| Time | Show | Explain |
|---|---|---|
| 0:00–0:45 | Board as Pedro; six workers and four gate columns | Persistent worker versus assignment; the server decides readiness |
| 0:45–1:30 | Ana/Fausto ready; Bruno QC, Carla terms, Diego employer, Elena rejected passport | Submitted is not completed; blockers are distinct and actionable |
| 1:30–2:30 | Bruno's passport: Rosa denied, then Luis approves; reload readiness | Independent QC is enforced server-side, including the capturer restriction |
| 2:30–3:30 | Select Ana, Carla, Diego and Fausto; book APT-1 | Two scheduled, two refused with reasons; capacity becomes zero |
| 3:30–4:00 | Switch to Sofía, then back to Pedro | Cross-branch access is denied; previous caller data disappears; bookings persist |
| 4:00–5:00 | Replay and concurrency integration tests with passing output | Original replay result, no duplicate history, last-seat and cross-appointment races |
| 5:00–6:00 | One code choice you are proud of | Suggested: shared readiness evaluation plus order/appointment transaction locks; explain the throughput trade-off |
| 6:00–7:00 | One code area you are least confident in; cuts and next steps | Suggested: whole-order history loading/coarse locking or asynchronous board error handling; explain actual limits, not a fabricated personal opinion |

### Optional terminal commands for the QC segment

These mutate only Bruno's review in the database used by the running local API. Use them only after confirming the intended fresh demo database. No real worker data is needed.

```sh
curl -i -X POST http://127.0.0.1:3001/api/document-versions/DOC-w-2-passport-1/review \
  -H 'X-User-Id: u-rosa' -H 'Content-Type: application/json' \
  -d '{"decision":"approve"}'
# Expected: 403; Rosa captured this version.

curl -i -X POST http://127.0.0.1:3001/api/document-versions/DOC-w-2-passport-1/review \
  -H 'X-User-Id: u-luis' -H 'Content-Type: application/json' \
  -d '{"decision":"approve"}'
# Expected: 200; Bruno becomes ready.
```

Switch Sofía then Pedro to reload readiness without a full-page reload. Explain that the user selector is a local demo mechanism, not production authentication.

## Before submitting

Watch the recording once. Confirm it is 5–8 minutes, readable, free of credentials, and includes both code choices in your own words. Add the recording link to the submission message; the repository does not currently contain a recording. Use the [submission checklist](submission-checklist.md) for the remaining delivery steps.

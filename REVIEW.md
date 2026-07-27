# Team Review Response — Payout-Critical Lifecycle

## Review received

> Please make the payout-critical lifecycle authoritative on-chain: enforce deadlines
> before evaluation, persist user-visible records only after confirmed contract writes,
> and add reconciliation or retries when chain updates fail. Add tests covering failed
> close, submission, dispute, and payout transitions so an arena cannot be scored early,
> orphaned, or left unable to finalize.

## Summary

Every requirement below is implemented and covered by tests. One real bug was found and
fixed in the process (dispute confirmation never persisted), and one build-breaking bug
was caught (`decryptPrivateKey` used without being imported).

## 1. Enforce deadlines before evaluation

- `runJudgingSweep()` in [`backend/src/jobs/weekly.ts`](backend/src/jobs/weekly.ts) only
  evaluates submissions whose competition is already `status: "judging"` **and** whose
  `endsAt` has passed — a competition still `open` never has its submissions scored,
  even if they're already registered on-chain.
- `closeCompetition()` is idempotent and only flips `open → judging` once `endsAt` has
  passed; it's driven by both an exact-time timer (`scheduleClose`) and a per-minute
  fallback sweep (`runDeadlineClose`) so a lost timer (e.g. a deploy restart) still
  closes the arena on time.
- [`backend/src/routes/submissions.ts`](backend/src/routes/submissions.ts) rejects a
  submission once `endsAt` has passed even in the narrow window before the close timer
  has actually fired — defense in depth against the deadline check living in only one
  place.

## 2. Persist user-visible records only after confirmed contract writes

- **Competition creation** (both user-hosted
  [`competitions.ts`](backend/src/routes/competitions.ts) and admin-created
  [`admin.ts`](backend/src/routes/admin.ts)): if the on-chain `create_competition` /
  `open_competition` calls fail, the DB row is deleted rather than left behind as an
  orphaned "open" arena with no path to close or finalize (both of those require
  `onchainCreated: true`).
- **Dispute registration** — *this was the one real gap found during this pass.*
  [`disputes.ts`](backend/src/routes/disputes.ts) created the dispute row and called
  `openDisputeOnChain`, but never set `onchainOpened: true` on success. That flag is
  exactly what `retryDisputeRegistrationSweep` checks to decide whether a dispute still
  needs retrying — without it, every dispute would be retried forever (duplicate
  on-chain writes) regardless of whether the first one actually landed. Fixed to only
  mark it confirmed once the chain call succeeds.
- **Submissions** already followed this pattern correctly — status only moves from
  `pending` to `onchain` after `submitMemeOnChain` succeeds.
- **Finalization/payout** — winners are only written to the DB (`status: "winner"`,
  `winnersJson`) after `finalizeCompetitionOnChain` succeeds *and* a subsequent read
  confirms the on-chain status is actually `"finalized"` (accounting for read-after-write
  lag). If that read never settles, nothing is persisted and the sweep retries next tick.

## 3. Reconciliation / retries when chain updates fail

Four independent retry sweeps run every tick in
[`weekly.ts`](backend/src/jobs/weekly.ts):

| Sweep | Retries |
|---|---|
| `retryOnchainCreationSweep` | Competitions stuck `open` with `onchainCreated: false` |
| `retrySubmissionRegistrationSweep` | Submissions stuck `pending` with no tx hash (within a 30-min window, then marked `failed`) |
| `retryDisputeRegistrationSweep` | Disputes stuck with `onchainOpened: false` |
| `runFinalization` | Competitions stuck in `judging` whose submissions are all processed, but whose finalize call or read hasn't settled yet |

Also fixed: `weekly.ts` called `decryptPrivateKey` in the retry sweeps without importing
it — this would have thrown at build/runtime the first time a retry actually fired.

## 4. Tests

New test suite (vitest + supertest, `npm test` in `backend/`) — 24 tests across 5 files,
using an in-memory fake Prisma client and a fake GenLayer service so tests exercise real
route/job logic rather than asserting on mock call arguments:

- [`weekly.test.ts`](backend/src/jobs/weekly.test.ts) — no early close/scoring before
  deadline, orphan-safe close (refuses to close/never-confirmed-on-chain), idempotent
  close, on-chain creation retry (success and repeated failure), no evaluation while
  still open, submission marked `failed` after 30 min unregistered, no partial/early
  payout while submissions are unprocessed, payout only recorded once finalize is
  confirmed, no payout if the finalize read never settles.
- [`submissions.test.ts`](backend/src/routes/submissions.test.ts) — accepts a genuinely
  open submission, rejects once the deadline passes even with `status: "open"` still
  set, rejects against a `judging` competition, keeps the row `pending` for retry rather
  than failing the request when the chain write errors.
- [`disputes.test.ts`](backend/src/routes/disputes.test.ts) — `onchainOpened` set only
  on confirmed success, left `false` on failure (regression test for the bug above),
  rejects disputes against unevaluated submissions.
- [`competitions.test.ts`](backend/src/routes/competitions.test.ts) /
  [`admin.test.ts`](backend/src/routes/admin.test.ts) — orphan rollback on failed
  on-chain creation for both creation paths, `onchainCreated` only persisted after
  success, dispute resolution syncs from confirmed on-chain state.

`tsc --noEmit` and `npm run build` are clean; all 24 tests pass.

## Deployment

These fixes are live on the production backend
(`https://meme-olympics-api-prod.fly.dev`), migrated to a new Fly.io account with the
`onchainOpened` column applied via Prisma migration `0004_dispute_onchain_tracking`, and
the frontend has been redeployed pointing at it.

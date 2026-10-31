# Steward review remediation

Status: **implemented, tested, deployed, and production-switched on
2026-10-31**.

This document maps every material issue from the milestone review to its
current implementation and verification evidence.

## 1. Contract-authoritative timing and completion

The GenLayer contract, not the backend, now enforces the payout-critical
lifecycle:

- `close_submissions` reads GenVM consensus time and rejects calls before the
  declared `ends_at` deadline.
- `evaluate_submission` accepts calls only while the arena is in `judging`.
- `finalize_competition` rejects until every registered submission is in a
  terminal judged/disqualified state and no dispute remains open.
- Competition timestamps are validated as ISO-8601 UTC values with coherent
  start/end ordering.

Adversarial coverage is in
[`contracts/tests/test_lifecycle_guards.py`](contracts/tests/test_lifecycle_guards.py):
premature closure, evaluation while open, and finalization with incomplete
judging all fail at the contract boundary. Current result: **3/3 passing**.

## 2. Challenge-safe settlement

Finalization creates provisional winners and a contract-derived 24-hour
`challenge_ends_at`. During that period:

- disputes may still be opened against judged submissions;
- an open dispute blocks settlement;
- an upheld dispute disqualifies the affected entry and deterministically
  promotes/reallocates the next eligible winner;
- `mark_prizes_relayed` is rejected before the challenge deadline.

The Base escrow mirrors the same safety boundary. `setWinners` records a
`claimableAfter` value and `claim`/`claimMany` reject early withdrawals. This
means no Base payout becomes irreversible while a financially consequential
GenLayer challenge can still change the winner set.

Escrow coverage is in
[`contracts/base/test/MemeOlympicsEscrow.t.sol`](contracts/base/test/MemeOlympicsEscrow.t.sol).
Current result: **2/2 passing**.

## 3. Partial cross-chain recovery

[`backend/src/services/baseSepolia.ts`](backend/src/services/baseSepolia.ts)
handles the case where Base `setWinners` succeeds but the subsequent GenLayer
relay marker fails. A retry now:

1. reads the existing Base pool;
2. verifies total allocation, claim deadline, winners, and per-winner balances;
3. locates the original `WinnersSet` event transaction;
4. returns that transaction hash and retries only the GenLayer marker.

It never blindly resends the one-time Base allocation.

## 4. Funding receipt verification

The frontend waits for successful Base Sepolia approval and deposit receipts,
checks receipt status and target address, then calls
`POST /api/competitions/:id/escrow-fund-confirm`. The backend independently
reads the transaction and escrow pool before the UI reports the prize funded.

## 5. Reproducible allocation and claim

[`contracts/base/e2e-example.js`](contracts/base/e2e-example.js) demonstrates
the complete Base Sepolia path: approve, deposit, allocate winners after the
contract challenge deadline, claim, and verify pool/claimable state after each
stage. Instructions are in
[`contracts/base/README.md`](contracts/base/README.md).

## 6. Verification and production evidence

- Backend Vitest suite: **27/27 passing**
- GenLayer adversarial lifecycle tests: **3/3 passing**
- Foundry escrow tests: **2/2 passing**
- Frontend production build: passing
- API health: https://meme-olympics-api-v2-gideon.fly.dev/health
- Live app: https://meme-olympics.vercel.app
- GenLayer contract:
  `0x5BDD6676c2f3cc2e04356A61b6Fc9Cd621f1d023`
- Base escrow: `0x372582652fc0aa9407B426a8779ee92dA5859Cf8`

The live verification script confirms that the configured GenLayer operator is
the contract owner/admin and that the configured Base escrow has deployed
bytecode with the expected owner, relayer, and Circle Base Sepolia USDC.

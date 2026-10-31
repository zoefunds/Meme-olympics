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
judging all fail at the contract boundary. The suite also proves that a
repeatedly undecodable image can be terminally disqualified on-chain and the
arena can then finalize. Current result: **4/4 passing**.

## 2. Challenge-safe settlement

Finalization creates provisional winners and a contract-derived 24-hour
`challenge_ends_at`. During that period:

- disputes may still be opened against judged submissions;
- an open dispute blocks settlement;
- an upheld dispute disqualifies the affected entry and deterministically
  promotes/reallocates the next eligible winner;
- `mark_prizes_relayed` is rejected before the challenge deadline.

The Base escrow mirrors the same safety boundary. `setWinners` records the
authoritative `claimableAfter` even when the worker submits the allocation
after that timestamp has passed; the allocation is then immediately
claimable. `claim`/`claimMany` still reject withdrawals before the deadline. This
means no Base payout becomes irreversible while a financially consequential
GenLayer challenge can still change the winner set.

Escrow coverage is in
[`contracts/base/test/MemeOlympicsEscrow.t.sol`](contracts/base/test/MemeOlympicsEscrow.t.sol).
Current result: **3/3 passing**.

Immediately before Base allocation, the worker re-reads the authoritative
GenLayer winners, reconciles its database cache, and pays that list. An upheld
post-finalization dispute therefore changes the Base recipient rather than
leaving the original cached finalist in place.

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
already-passed contract challenge deadline, claim, and verify the pool,
claimable state, and winner USDC balance increase. Instructions are in
[`contracts/base/README.md`](contracts/base/README.md).

## 6. Verification and production evidence

- Backend Vitest suite: **29/29 passing**
- GenLayer adversarial lifecycle tests: **4/4 passing**
- Foundry escrow tests: **3/3 passing**
- Frontend production build: passing
- API health: https://meme-olympics-api-v2-gideon.fly.dev/health
- Live app: https://meme-olympics.vercel.app
- GenLayer contract: `0xeE76760172cbCD1ed33B41863b44AE8F74D2EE25`
- Base escrow: `0x951773259a9c90bE6DCfB5C9E4aedA9fBe89F10c`

The live verification script confirms that the configured GenLayer operator is
the contract owner/admin and that the configured Base escrow has deployed
bytecode with the expected owner, relayer, and Circle Base Sepolia USDC.

# Meme Olympics milestone v1 — settlement-safe release

Submitted state verified on **2026-10-31**.

## What the project is

Meme Olympics is a GenLayer-native competition application where validators
inspect actual meme image bytes and independently re-evaluate nine weighted
criteria, eligibility, and plagiarism. The Intelligent Contract owns the
competition lifecycle and deterministic ranking. A separate Base Sepolia
escrow holds real USDC and lets winners claim from their own wallets.

## Review-critical improvements

### Contract lifecycle guards

The current GenLayer contract enforces all timing and completion requirements
itself:

- no early `close_submissions` before `ends_at`;
- no `evaluate_submission` while an arena is open;
- no finalization until every submission is terminal;
- no finalization or settlement while a dispute is open;
- deterministic timestamps derived from GenVM consensus time, not caller input.

### Challenge-safe payout lifecycle

Finalization opens a 24-hour on-chain challenge window and creates provisional
winners. An upheld challenge can disqualify a provisional winner and promote
the next eligible entry before money is allocated. GenLayer refuses to mark
prizes relayed until the window is closed and all disputes are resolved.

Base `setWinners` receives the authoritative `challenge_ends_at` as
`claimableAfter`. Both `claim` and `claimMany` enforce it, providing a second
on-chain barrier against irreversible early payout. Because allocation occurs
after the challenge closes, the escrow accepts an already-passed nonzero
deadline and makes the resulting balance immediately claimable.

The relay fetches winners from GenLayer again immediately before allocating
USDC. Cached finalization data is never used to select recipients, so an
upheld dispute and deterministic promotion are reflected on Base.

After three `INVALID_IMAGE` failures, the owner records a narrow,
reason-bearing terminal disqualification on GenLayer and confirms it before
mirroring the status locally. This prevents an unjudgeable pending entry from
blocking strict finalization without creating a database-only result.
Each failure must carry a distinct failed evaluation transaction hash. The
contract stores all three commitments and exposes them through
`get_submission`; duplicate or missing evidence cannot authorize the terminal
transition.

### Cross-chain reconciliation

Base winner allocation remains one-time and idempotent. If allocation succeeds
but the GenLayer marker fails, the backend verifies the existing Base pool and
per-winner amounts, recovers the original `WinnersSet` transaction hash, and
continues from the completed step instead of repeating `setWinners` forever.
Recovery decodes the original allocation calldata and combines current
claimable balances with `Claimed` events, so already-paid winners reconcile.

### Verified funding UX

The frontend does not equate wallet submission with successful funding. It
waits for the approval and deposit receipts, validates status and destination,
then asks the backend to independently confirm the Base transaction and escrow
pool before displaying the arena as funded.

## Wallet and custody model

- The connected wallet signs authentication, arena creation/opening, meme
  submission, dispute opening, USDC approval/deposit, and reward claims.
- EIP-6963 provider discovery supports multiple injected wallets without
  silently selecting the wrong extension.
- The backend holds no user private keys.
- The GenLayer operator is limited to lifecycle administration.
- The Base relayer can allocate finalized winners but cannot claim for them.

## Tests and reproducibility

- `backend`: 32 Vitest tests
- `contracts/tests/test_lifecycle_guards.py`: 4 adversarial GenLayer tests
- `contracts/base/test/MemeOlympicsEscrow.t.sol`: 3 Foundry escrow tests
- `contracts/base/e2e-example.js`: funded allocation and successful claim
  example for Base Sepolia

All suites pass in the submitted state.

## Current production deployment

- App: https://meme-olympics.vercel.app
- API: https://meme-olympics-api-v2-gideon.fly.dev
- GenLayer: `0x9Dd95B81a12C4Fa7fB371F678Eb7fa9FC59ee80F`
- Base escrow: `0x951773259a9c90bE6DCfB5C9E4aedA9fBe89F10c`
- Base Sepolia USDC: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
- Base owner/relayer: `0x3ac70057A8Dd00Fcd590a6Bb59ce94D1222659dC`
- Production source commit: `2cd8f68`
- Vercel deployment: `dpl_Ay7fQDEsvW8m6mdEy4bTmisrkCss`

The production backend and PostgreSQL health checks pass. The production chain
verification confirms GenLayer owner/admin authority and Base escrow
owner/relayer/USDC configuration.

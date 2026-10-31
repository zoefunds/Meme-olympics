# MemeOlympicsEscrow (Base Sepolia)

Payment layer for Meme Olympics. GenLayer (`contracts/meme_olympics.py`) is
the adjudication layer only — it judges memes and computes winners/USDC
amounts but never escrows real value. This contract holds real USDC and
lets winners self-claim.

Current Base Sepolia deployment:
`0x951773259a9c90bE6DCfB5C9E4aedA9fBe89F10c`.

This settlement-safe version changes `setWinners` and `getPool` and adds
per-pool claim timing. Never point the current relayer ABI at a retired escrow.

## Deploy

```bash
cd backend
npm install   # picks up the solc devDependency
npm run deploy:escrow
```

Put deployment values in the local, gitignored `backend/.env`. Never place a
private key in a command argument, shell history, source file, chat, or screen
share. For a forced relayer rotation use
`backend/scripts/rotate-base-relayer-and-deploy.js`; it writes the fresh key to
the protected local env before funding/deploying and never prints it.

Copy the deployed address into `backend/.env`:

```
MEME_OLYMPICS_ESCROW_ADDRESS=0x951773259a9c90bE6DCfB5C9E4aedA9fBe89F10c
```

## How money flows

1. A host creates a competition on GenLayer with a *declared* USDC prize
   (`create_competition(..., prize_pool_usdc=...)`) — informational only.
2. The host (or anyone) deposits the matching real USDC on this contract:
   `approve(escrow, amount)` on USDC, then `fundCompetition(competitionId, amount)`.
   `backend/src/routes/competitions.ts`'s `/escrow-fund-calldata` endpoint
   returns both calls ready to send from the frontend via the user's wallet.
3. GenLayer judges every submission and finalizes, producing a winners list
   with USDC amounts (`get_competition(id).winners[].reward_usdc`). A 24-hour
   on-chain challenge period starts at finalization. New disputes are rejected
   when it closes; any open dispute blocks settlement until resolved.
4. The backend relayer (`backend/src/services/baseSepolia.ts`,
   `backend/src/jobs/weekly.ts`'s `runPrizeRelaySweep`) calls
   `setWinners(competitionId, winners, amounts, challengeEndsAt)` here, using the wallet at
   `BASE_SEPOLIA_RELAYER_PRIVATE_KEY`, then calls `mark_prizes_relayed` back
   on GenLayer so it's never relayed twice. It only does this once the
   GenLayer contract says the challenge period is over.
   The timestamp may therefore already be in the past when `setWinners` is
   mined; it must be nonzero and remains the authoritative claim boundary.
5. Winners call `claim(competitionId)` (or `claimMany`) themselves, from
   their own wallet — the backend never holds or moves their USDC.

## Security notes

- `setWinners` can only be called once per `competitionId` (idempotency
  gate) and only by the configured `relayer` address. The backend reconciles
  an already-set allocation by locating its `WinnersSet` transaction, decoding
  the original calldata, and proving each original award equals the current
  claimable balance plus matching `Claimed` events. It never retries the
  irreversible write, even if a winner claimed before marker recovery.
- Claims are time-locked by `claimableAfter`; the escrow rejects both
  `claim` and `claimMany` until the GenLayer challenge deadline.
- Allocation after an already-ended challenge is accepted and immediately
  claimable; the escrow does not replace the GenLayer timestamp with a new
  caller-selected delay.
- Claims use a pull pattern with checks-effects-interactions and a
  reentrancy guard.
- The owner can rotate the relayer (`setRelayer`) and reclaim only
  never-allocated deposits (`withdrawUnallocated`) — it can never touch
  anything already committed to a winner.

## Reproducible Base Sepolia settlement example

After finalization and the 24-hour challenge window, run the script below
with testnet-only wallets and USDC. It funds a keyed pool, allocates a funded
winner list using an already-passed challenge deadline, has the winner claim,
and verifies both the exact USDC balance increase and zero remaining
claimable balance. The timestamp **must** be the `challenge_ends_at` returned
by GenLayer for the competition — it is not a caller-selected release time.

```bash
cd backend
node ../contracts/base/e2e-example.js
```

Before running, load the documented variables (`HOST_PRIVATE_KEY`,
`RELAYER_PRIVATE_KEY`, `WINNER_PRIVATE_KEY`, `MEME_OLYMPICS_ESCROW_ADDRESS`,
`COMPETITION_ID`, `AMOUNT_USDC`, and `CHALLENGE_ENDS_AT_UNIX`) from a local
secret manager into the process environment. Do not put literal private keys
in the command or shell history.

The script prints the approval, deposit, allocation, and claim transaction
hashes. It verifies the allocated pool/deadline, then proves completion by
checking the winner's exact USDC balance increase and zero residual claimable
balance after the claim.

A completed live run, including transaction hashes, block numbers, final
state, and its precise scope, is recorded in [E2E_EVIDENCE.md](E2E_EVIDENCE.md).

Automated recovery coverage is in
`backend/src/services/baseSepolia.test.ts`; the tests include a fully claimed
award before marker recovery and rejection of inconsistent claim history.

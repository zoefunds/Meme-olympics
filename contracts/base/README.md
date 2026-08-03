# MemeOlympicsEscrow (Base Sepolia)

Payment layer for Meme Olympics. GenLayer (`contracts/meme_olympics.py`) is
the adjudication layer only — it judges memes and computes winners/USDC
amounts but never escrows real value. This contract holds real USDC and
lets winners self-claim.

## Deploy

```bash
cd backend
npm install   # picks up the solc devDependency
DEPLOYER_PRIVATE_KEY=<your key, never committed or pasted anywhere> \
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org \
BASE_SEPOLIA_USDC_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e \
RELAYER_ADDRESS=<backend relayer wallet address> \
npm run deploy:escrow
```

Put a private key in your shell env or a local, gitignored `.env` you
`source` before running — never as a literal in a command someone can see
in shell history, chat, or a screen share.

Copy the deployed address into `backend/.env`:

```
MEME_OLYMPICS_ESCROW_ADDRESS=0x...
```

## How money flows

1. A host creates a competition on GenLayer with a *declared* USDC prize
   (`create_competition(..., prize_pool_usdc=...)`) — informational only.
2. The host (or anyone) deposits the matching real USDC on this contract:
   `approve(escrow, amount)` on USDC, then `fundCompetition(competitionId, amount)`.
   `backend/src/routes/competitions.ts`'s `/escrow-fund-calldata` endpoint
   returns both calls ready to send from the frontend via the user's wallet.
3. GenLayer judges submissions and finalizes, producing a winners list with
   USDC amounts (`get_competition(id).winners[].reward_usdc`).
4. The backend relayer (`backend/src/services/baseSepolia.ts`,
   `backend/src/jobs/weekly.ts`'s `runPrizeRelaySweep`) calls
   `setWinners(competitionId, winners, amounts)` here, using the wallet at
   `BASE_SEPOLIA_RELAYER_PRIVATE_KEY`, then calls `mark_prizes_relayed` back
   on GenLayer so it's never relayed twice.
5. Winners call `claim(competitionId)` (or `claimMany`) themselves, from
   their own wallet — the backend never holds or moves their USDC.

## Security notes

- `setWinners` can only be called once per `competitionId` (idempotency
  gate) and only by the configured `relayer` address.
- Claims use a pull pattern with checks-effects-interactions and a
  reentrancy guard.
- The owner can rotate the relayer (`setRelayer`) and reclaim only
  never-allocated deposits (`withdrawUnallocated`) — it can never touch
  anything already committed to a winner.

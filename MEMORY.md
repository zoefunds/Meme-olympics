# Meme Olympics — current project memory

Last verified: **2026-10-31**.

This file contains current operational facts. The listed chain addresses run
the preceding release; the repository head contains a tested contract update
that still requires coordinated redeployment.

## Production

- App: https://meme-olympics.vercel.app
- API: https://meme-olympics-api-v2-gideon.fly.dev
- API health: https://meme-olympics-api-v2-gideon.fly.dev/health
- GenLayer StudioNet contract:
  `0x5BDD6676c2f3cc2e04356A61b6Fc9Cd621f1d023`
- Base Sepolia escrow:
  `0x372582652fc0aa9407B426a8779ee92dA5859Cf8`
- Base Sepolia USDC:
  `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
- Fly backend app: `meme-olympics-api-v2-gideon`
- Fly PostgreSQL app: `meme-olympics-db-v2-gideon`

The backend has one always-on Fly machine (`min_machines_running=1`,
`auto_stop_machines=false`). Cron work is Redis-locked and remains safe if the
service is scaled horizontally later. The replacement PostgreSQL database was
created fresh during the 2026-10-31 switchover; retired database contents were
not migrated.

## Authoritative lifecycle

1. A host registers an arena in the API, signs `create_competition` and
   `open_competition` with their own wallet, and confirms the resulting state
   back to the API.
2. If a prize is declared, the host approves and deposits Base Sepolia USDC.
   The frontend waits for successful transaction receipts and the backend
   independently confirms the escrow pool before reporting the arena funded.
3. `close_submissions` reads GenVM consensus time and rejects closure before
   `ends_at`. Direct transactions cannot bypass this rule.
4. `evaluate_submission` is accepted only while the arena is in `judging`.
5. `finalize_competition` requires every submission to be terminal and every
   open dispute resolved. Winners are deterministic.
6. Finalization opens a 24-hour challenge period. Winning submissions may be
   disputed during this window; an upheld dispute rebalances provisional
   winners and allocations on GenLayer.
7. Only after the challenge window closes and no dispute remains open may the
   relayer call Base `setWinners`. Base claims are independently time-locked by
   the same `claimableAfter` timestamp. A deadline already passed at allocation
   time is valid and makes the award immediately claimable.
8. If Base allocation succeeds but the GenLayer relay marker fails, retries
   verify the existing pool and recover the original `WinnersSet` transaction
   instead of resending the one-time allocation.
9. Winners call `claim` or `claimMany` directly from their own wallet. The
   backend never custodies prize money.
10. The relay re-reads winners from GenLayer immediately before Base
    allocation. Repeatedly undecodable images become terminal only through the
    contract's admin-only, reason-bearing recovery call.

## Contract authority

- Users sign login, arena creation/opening, meme submission, dispute opening,
  USDC funding, and claims with the selected injected wallet.
- The GenLayer operator signs only administrative lifecycle work: close,
  judge, finalize, resolve disputes, and mark prizes relayed.
- The Base relayer signs only winner allocation after GenLayer authorizes
  settlement.
- Production verification confirms the configured GenLayer operator is the
  contract owner/admin and the configured Base relayer is both escrow owner
  and relayer.

## Verification commands

```bash
# Backend type checks, integration tests, and build
cd backend
npm run typecheck
npm test -- --run
npm run build

# Live chain ownership/configuration checks
npm run verify:production-chains

# GenLayer adversarial lifecycle tests
cd ..
python3 -m pytest contracts/tests/test_lifecycle_guards.py

# Base escrow tests (Foundry)
cd contracts/base
forge test

# Frontend production build
cd ../../frontend
npm run build
```

Current verified counts: backend **29/29**, GenLayer lifecycle **4/4**, Base
escrow **3/3**.

## Operational rules

- Never reuse or fund the retired Base relayer/escrow.
- Never place a private key in a command argument, source file, issue, or chat.
  `backend/scripts/set-production-secrets.ts` sends Fly secrets over stdin.
- Attach Fly PostgreSQL using a non-superuser application role. The production
  secret importer intentionally does not overwrite `DATABASE_URL`.
- After any GenLayer redeploy, verify `get_contract_info` and `is_admin` before
  enabling workers.
- After any escrow redeploy, verify bytecode, owner, relayer, and USDC address.
- A successful build is not a deployment check: verify Fly health, PostgreSQL
  health, Vercel HTTP 200, and live chain configuration separately.

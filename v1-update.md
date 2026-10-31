# Production update — 2026-10-31

This supersedes earlier source and migration notes. The tested settlement
corrections are deployed at the addresses below.

## Deployment

- GenLayer StudioNet contract:
  `0x9Dd95B81a12C4Fa7fB371F678Eb7fa9FC59ee80F`
- Base Sepolia escrow:
  `0x951773259a9c90bE6DCfB5C9E4aedA9fBe89F10c`
- Backend: https://meme-olympics-api-v2-gideon.fly.dev
- Frontend: https://meme-olympics.vercel.app
- Fly PostgreSQL: `meme-olympics-db-v2-gideon`
- Base relayer/escrow owner:
  `0x3ac70057A8Dd00Fcd590a6Bb59ce94D1222659dC`
- GenLayer deployment transaction:
  `0xf57597f5776935f22b6f5be08404763faf5ffed2eee88bd89b0e37f9a14f432b`
- Vercel production deployment: `dpl_Ay7fQDEsvW8m6mdEy4bTmisrkCss`

The Fly backend was recreated in the current account and switched to a fresh,
least-privilege PostgreSQL attachment. Old database contents were intentionally
not migrated. The production frontend was rebuilt with the new API and
GenLayer address.

## Security rotation

A fresh Base Sepolia relayer wallet and replacement escrow were deployed. The
retired relayer and escrow must not be reused or funded. Fly secrets are
imported through stdin, and `DATABASE_URL` is managed only by `fly postgres
attach` so the deploy script cannot overwrite it with a local or retired URL.

## Lifecycle changes

- contract-enforced arena deadline;
- judging allowed only after closure;
- finalization requires complete judging and resolved disputes;
- 24-hour challenge window before settlement;
- provisional winner rebalancing after upheld disputes;
- Base claim time lock using the authoritative challenge timestamp;
- partial relay recovery when Base succeeds before the GenLayer marker;
- Base deposit receipt and escrow-pool verification before showing “funded”;
- post-challenge Base allocation accepts the already-passed authoritative
  deadline and is immediately claimable;
- settlement re-reads authoritative post-dispute winners instead of cached
  finalization JSON;
- repeated `INVALID_IMAGE` reaches an audited terminal on-chain
  disqualification before the database mirrors it;
- three distinct failed evaluation transaction hashes are required and stored
  before terminal image disqualification, and only the contract owner may
  execute that terminal transition;
- partial Base recovery verifies original allocation calldata and accounts
  for claims completed before the GenLayer marker retry.

## Deployment tooling

- `backend/scripts/deploy-genlayer.ts` — GenLayer deployment
- `backend/scripts/rotate-base-relayer-and-deploy.js` — safe relayer rotation
  and replacement escrow deployment
- `backend/scripts/set-production-secrets.ts` — stdin-only Fly secret import
- `backend/scripts/verify-production-chains.ts` — read-only live ownership and
  configuration audit
- `backend/scripts/ensure-runtime-secrets.ts` — generates missing local random
  JWT/encryption values without printing them

## Verified results

- Backend: 32/32 tests
- GenLayer lifecycle: 4/4 tests
- Base escrow: 3/3 tests
- Frontend: production build successful
- Fly API check: passing
- Fly PostgreSQL checks: 3/3 passing
- Vercel production deployment: ready and aliased
- Live chain ownership/configuration audit: passing
- Production source commit `2cd8f68`: pushed to `main`

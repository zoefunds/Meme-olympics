# Release update — 2026-10-31

This supersedes earlier source notes. The tested source includes three final
settlement corrections, but the listed addresses remain the preceding live
release until a coordinated GenLayer/Base migration is completed.

## Deployment

- GenLayer StudioNet contract:
  `0x5BDD6676c2f3cc2e04356A61b6Fc9Cd621f1d023`
- Base Sepolia escrow:
  `0x372582652fc0aa9407B426a8779ee92dA5859Cf8`
- Backend: https://meme-olympics-api-v2-gideon.fly.dev
- Frontend: https://meme-olympics.vercel.app
- Fly PostgreSQL: `meme-olympics-db-v2-gideon`

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
- Base deposit receipt and escrow-pool verification before showing “funded.”
- post-challenge Base allocation accepts the already-passed authoritative
  deadline and is immediately claimable;
- settlement re-reads authoritative post-dispute winners instead of cached
  finalization JSON;
- repeated `INVALID_IMAGE` reaches an audited terminal on-chain
  disqualification before the database mirrors it.

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

- Backend: 29/29 tests
- GenLayer lifecycle: 4/4 tests
- Base escrow: 3/3 tests
- Frontend: production build successful
- Fly API check: passing
- Fly PostgreSQL checks: 3/3 passing
- Vercel production deployment: ready and aliased
- Live chain ownership/configuration audit: passing

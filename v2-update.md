# v2 Update — August 8, 2026

Changelog for everything changed today: a GenLayer contract migration (with
a full production data reset), two production bugs found from real user
reports and fixed at the root cause, a hardening pass on wallet
network-switching, a mobile-friendliness pass across the whole app, and two
operational incidents hit and resolved while dogfooding the new contract
right after migration.

---

## 1. GenLayer contract migration

The GenLayer Intelligent Contract was redeployed at a new address:

```
0x31E458C494FDFE74e3Fdd23e46009544074333Fa
```

- Updated everywhere the previous address was configured: the `GENLAYER_CONTRACT_ADDRESS`
  Fly secret on the production backend (`meme-olympics-api-prod`, redeployed
  and health-checked), `NEXT_PUBLIC_GENLAYER_CONTRACT_ADDRESS` on Vercel
  (frontend rebuilt and redeployed, since it's baked in at build time), and
  local `backend/.env` / `.env.production`.
- **Production database wiped clean of everything tied to the previous
  contract deployment** — all `Competition`, `Submission` and `Dispute`
  rows (1 competition, 5 submissions, 0 disputes at the time), via
  [backend/scripts/wipe-competitions.ts](backend/scripts/wipe-competitions.ts)
  run directly against production Postgres. Users and uploaded images were
  left untouched. Verified `0/0/0` remaining afterward, and the live API
  confirmed with `{"competitions":[]}`.
- **No auto-creation of arenas exists anywhere in the codebase** — arenas
  are only ever user- or admin-initiated (`runWeeklyRollover` is kept only
  as a manual `POST /api/admin/rollover` trigger, not cron-scheduled) — so
  nothing could spring an old-contract arena back to life under the new
  address. Confirmed by reading [backend/src/jobs/weekly.ts](backend/src/jobs/weekly.ts)
  before touching anything.

## 2. Submission dedup bug: DB no longer overrides on-chain truth

**Reported bug:** a user submitted a meme, got an error, and the frontend
showed a failure — but the DB row *had* been created. On retry, the backend
rejected the resubmission with "You already submitted to this arena," even
though the submission never actually landed on-chain at all.

**Root cause:** [backend/src/routes/submissions.ts](backend/src/routes/submissions.ts)
creates the DB row as `status: "pending"` immediately, before the wallet
even signs the on-chain `submit_meme` transaction (the frontend signs and
sends it after the row exists). If that transaction never lands — rejected,
wallet closed, network drop — the row stays `"pending"` forever. The
per-user dedup check counted **all** statuses, not just confirmed ones, so
a submission that never reached the chain still permanently occupied the
1-per-arena slot. The existing 30-minute stale-cleanup job only runs once
an arena reaches `"judging"` status, so a still-`"open"` arena (the normal
case) never got swept.

**Fix:** the dedup check now self-heals first — any of the user's own
`"pending"` rows for that arena older than 10 minutes are automatically
marked `"failed"` before the count runs, and the count itself excludes
`"failed"` rows. The database now reflects what's actually finalized
on-chain, not the other way round, per the explicit design goal for this
fix.

## 3. RESYNC FROM CHAIN triggering `set_competition_defaults` on-chain errors

**Reported bug:** the "RESYNC FROM CHAIN" button on an arena page — meant
to be a safe, idempotent, read-only re-check against GenLayer and the
escrow contract — was triggering `set_competition_defaults` on the GenLayer
contract, which then errored on-chain.

**Root cause:** [backend/src/routes/competitions.ts](backend/src/routes/competitions.ts)'s
`POST /:id/onchain-confirm` route — which resync calls — unconditionally
fired `gl.setCompetitionDefaultsOnChain(3, 1)` on every single confirm, with
no gate. This write is only meant to run once, right after an arena's
first on-chain confirmation (as defense-in-depth to keep the contract's
per-user submission cap aligned with the backend's own rule) — but resync
re-runs the same route on arenas that are already long confirmed, resending
a redundant admin-only contract call every time.

**Fix:** the write is now gated on `!comp.onchainCreated`, so it only fires
the first time an arena confirms. Resync on an already-confirmed arena no
longer touches `set_competition_defaults` at all.

## 4. Backend wallet function inventory

At the user's request, documented every on-chain function the backend's
own wallets (not a user's connected wallet) call, across both chains:

**GenLayer operator wallet** (`GENLAYER_OPERATOR_PRIVATE_KEY`, via
[backend/src/services/genlayer.ts](backend/src/services/genlayer.ts)):
`create_competition`, `open_competition`, `set_competition_defaults`,
`close_submissions`, `finalize_competition`, `evaluate_meme`,
`resolve_dispute`, `mark_prizes_relayed`.

**Base Sepolia relayer wallet** (`BASE_SEPOLIA_RELAYER_PRIVATE_KEY`, via
[backend/src/services/baseSepolia.ts](backend/src/services/baseSepolia.ts)):
`setWinners` on the escrow contract.

## 5. Wallet network-switch/add hardening

**Reported bug:** a friend's wallet had never had the GenLayer Studio
network added. Submitting a meme should have triggered the wallet's native
"Add Network" popup automatically — instead, nothing happened until the
network was added manually.

**Root cause:** the add/switch-network logic already existed
([frontend/src/lib/genlayer.ts](frontend/src/lib/genlayer.ts)'s
`ensureStudioNetwork()` and [frontend/src/lib/baseSepolia.ts](frontend/src/lib/baseSepolia.ts)'s
`ensureBaseSepolia()`, both called automatically before every relevant
on-chain write), but it only triggered the add-network fallback when the
wallet threw the exact EIP-3085 error code `4902` ("unrecognized chain").
Not every wallet reports "chain not added" that way — some wrap it in a
generic RPC error, others silently no-op the switch instead of throwing —
so for wallets like that, the fallback branch never ran and no popup ever
appeared.

**Fix:** both functions now read the wallet's *actual* active chain via
`eth_chainId` after any switch attempt, regardless of whether an error was
thrown or what shape it had. If the chain still doesn't match, they call
`wallet_addEthereumChain` explicitly and retry the switch — so the popup
fires reliably across wallets, not just ones that report the standard error
code, for every GenLayer write (submit meme, host arena, open dispute) and
every Base Sepolia transaction (fund arena, claim rewards).

## 6. Mobile-friendliness pass

The app already had a solid mobile foundation (bottom tab bar, content
padding for the fixed header/nav, `overflow-x-auto` on wide tables,
responsive grids on nearly every page). Audited every page at 375×812 and
found and fixed two real bugs:

- **[frontend/src/components/Nav.tsx](frontend/src/components/Nav.tsx)** —
  the top header broke for a logged-in user on mobile: the logo wrapped to
  two lines and the username/admin-badge/settings/exit cluster overflowed
  the fixed-height header, overlapping page content underneath. Nothing in
  that row shrank or hid at small widths. Fixed by switching to the
  `Logo` component's existing `compact` (icon-only) mode below the `md`
  breakpoint, and hiding the redundant username/address link on mobile
  (already reachable via the bottom nav's "Me" tab) while keeping
  Admin/Settings/Exit as compact, non-wrapping items.
- **[frontend/src/app/settings/page.tsx](frontend/src/app/settings/page.tsx)** —
  the USDC Balance section forced 3 stat tiles (large numbers, long labels
  like "CONNECTED WALLET (Base Sepolia)") into a fixed 3-column grid with
  no mobile breakpoint, which would crush the numbers illegibly on a phone.
  Now stacks to 1 column below `sm`, 3 columns above.

Verified with screenshots at 375×812 before and after, confirmed the
desktop layout is unaffected, and both a clean TypeScript build and a
production `next build` pass.

## 7. New contract deployment needed its admin re-registered

**Symptom:** right after the contract migration (section 1), the first
real on-chain admin action — `set_competition_defaults`, fired
automatically on an arena's first confirm (section 3's fix working as
intended) — failed with:

```
[EXPECTED] Only admin may call this
```

**Root cause:** this is the exact "redeploy needs its admin re-added" issue
already called out in [README.md](README.md)'s contract design notes — a
GenLayer contract's admin list does **not** carry over across a redeploy.
Only the wallet that deployed the new contract in GenLayer Studio is admin
by default; the backend's own operator wallet
(`0x4A6666C015BE347799E0B25cfE27bfd3847027BB`, from `GENLAYER_OPERATOR_PRIVATE_KEY`)
has to be explicitly re-added on every new deployment or every
operator-signed action fails the same way — `set_competition_defaults`,
`close_submissions`, `evaluate_meme`, `finalize_competition`,
`resolve_dispute`, `mark_prizes_relayed`.

**Fix:** the contract owner called `add_admin("0x4A6666C015BE347799E0B25cfE27bfd3847027BB")`
on the new contract from GenLayer Studio. Re-ran `set_competition_defaults(3, 1)`
directly against production afterward to confirm — it went through cleanly
(`0xd4ffff6f9710ece3749a7d9fc9180f14159dcdd785fd773a8f0d36ef0b238f80`). The
one call that failed before the fix landed was fire-and-forget
(`.catch(() => undefined)` in [backend/src/routes/competitions.ts](backend/src/routes/competitions.ts)) —
it never touched the DB or blocked the arena's own confirmation, so no
cleanup was needed beyond the retry.

## 8. Arena-hosting rate limit exhausted during post-migration testing

**Symptom:** `POST /api/competitions` returned `429 Too Many Requests` /
"Too many requests. Please slow down." while trying to host a new test
arena after the migration.

**Root cause:** not GenLayer Studio's 30 req/min chain-level limit (that's
handled separately, client-side, with retry/backoff in
[frontend/src/lib/genlayer.ts](frontend/src/lib/genlayer.ts)'s `withBackoff`)
— this was the backend's own anti-spam cap of **3 arena-hosts per day per
user** ([backend/src/routes/competitions.ts](backend/src/routes/competitions.ts)),
exhausted by repeated hosting attempts while testing the migration end to
end.

**Fix:** cleared the exhausted `rl:create-comp:*` buckets directly in
production Redis (Upstash) to unblock immediately. The 3/day cap itself
was left as-is — it's an intentional anti-spam policy, not a bug — but is
worth revisiting if admin-wallet testing needs a higher (or exempted)
limit going forward.

---

All backend fixes covered by the existing vitest suite (pre-existing,
unrelated failures confirmed present before these changes via `git stash`);
frontend changes verified with `tsc --noEmit` and a full production build.
Deployed live: backend via `fly deploy` to `meme-olympics-api-prod`,
frontend via `vercel deploy --prod` to `meme-olympics`.

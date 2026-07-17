# MEMORY — Meme Olympics

Living project memory. Update as decisions land.

## What this is
Weekly crypto-meme competitions where winners are decided by **GenLayer
Intelligent Contract validator consensus** (LLM judging), never by likes or
votes. One serious project, one robust contract.

## Architecture decisions
- **Backend**: Node 20 + TypeScript + Express + Prisma + PostgreSQL (Docker
  locally, Fly Postgres in prod). Hosted on **Fly.io** with
  `auto_stop_machines=false`, `min_machines_running=1` → 24/7.
- **Frontend**: Next.js 14 App Router + Tailwind on **Vercel**. Design system
  = "Aura Arena" (deep-space #131314, Olympic gold #FFD700, electric purple
  #7701D0, neon cyan #00F1FE; Space Grotesk / Inter / JetBrains Mono;
  glassmorphism, scanlines, segmented console progress bars).
- **Auth**: email + password (JWT). Registration auto-creates an EVM wallet
  (ethers), AES-256-GCM-encrypted in Postgres under `WALLET_ENCRYPTION_KEY` —
  survives devices/reinstalls; export requires password re-check.
- **Email**: Brevo REST API (`api.brevo.com/v3/smtp/email`) — password reset,
  welcome, evaluation results, winner notifications. Sender: preciousmofeoluwa@gmail.com.
- **Redis (Upstash)**: deliberately minimal to avoid maxing the quota — only
  rate-limit INCRs on sensitive routes and 60–120s leaderboard/competition
  caches; fail-open when unavailable. All Redis access lives in
  `backend/src/lib/redis.ts`.

## Intelligent contract (`contracts/meme_olympics.py`, ~1700 lines)
- Runner pinned: `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6`
  (never `test`/`latest` — networks reject them).
- **Correct GenVM API**: `gl.message.sender_address` (NOT `sender_account` —
  caused the first deploy failure).
- Consensus design: custom validators via `gl.vm.run_nondet_unsafe`; validator
  independently re-runs judging and compares stable fields with tolerances
  (total ±15/100, 7-of-9 criteria within ±5, plagiarism "copied" hard gate at
  confidence ≥70). Error prefixes [EXPECTED]/[EXTERNAL]/[TRANSIENT]/[LLM_ERROR].
- Finalization + rewards fully deterministic (50/30/20 split, atto-scale u256).
- Disputes require a public evidence URL fetched **on-chain**; unfetchable
  evidence ⇒ auto-reject (never judge from user text alone).

## Lifecycle automation (backend cron, UTC)
- Mon 00:05 rollover (close last week → judging, open `week-YYYY-WW`)
- Hourly :15 judging sweep (evaluate up to 10 on-chain pending)
- Hourly :45 finalization attempt + winner emails

## Deployment status
- [x] Repo: https://github.com/zoefunds/Meme-olympics (no Claude attribution)
- [x] Contract deployed to StudioNet (CURRENT): `0x9F64636ba66ae1e893AA436A6B94dbA4706052Ee`
      (owner/deployer: 0x7401c129EDfc26E68FE19309fE461eb3Db1058Eb, deployed via
      Studio UI so sender resolved correctly; verified via get_contract_info).
      Now supports REAL GEN value transfer (see below), creator-can-finalize,
      and permissionless competition creation/funding.
      Prior addresses (superseded, kept for history): 0x36E5...3323, 0x1cFe...5903,
      0xC31D...9224 — each redeployed to clear test-data error states or add features.
- [x] Fly deploy live at meme-olympics-api.fly.dev, GENLAYER_CONTRACT_ADDRESS
      updated to the current address above.
- [x] Vercel deploy live at meme-olympics.vercel.app.
- [ ] **Outstanding on every fresh contract deploy**: contract owner must call
      `add_admin(<backend operator address>)` in Studio before automated
      judging-sweep/finalization crons can act (backend operator key persists
      across deploys — the SAME address needs re-granting admin each time the
      contract address changes). Current backend operator: `0x4A6666C015BE347799E0B25cfE27bfd3847027BB`.

## Real GEN value transfer (added — read before touching money paths)
- Contract methods: `create_competition` and `fund_competition` are
  `@gl.public.write.payable` — GEN sent as tx `value` becomes/adds-to that
  competition's real escrowed `prize_pool_atto` (the contract's own native
  balance backs it, readable via `self.balance` / `get_contract_info().contract_gen_balance_atto`).
  `claim_reward()` is self-serve: caller pulls their full `reward_balances_atto`
  to their own wallet via a genuine on-chain transfer.
- **Confirmed working call pattern on THIS pinned runner** (validated via a
  throwaway test contract before touching production — see below): outbound
  transfer is `gl.get_contract_at(Address(to)).emit(value=u256(amount)).emit_transfer()`
  — NOT `.emit_transfer(value)` as the newest genvm main-branch docs show
  (that form raises `TypeError: emit_transfer() takes 1 positional argument
  but 2 were given` on the pinned runner). The genvm GitHub repo is often
  AHEAD of what `py-genlayer:1jb45aa8...` actually ships — don't trust its
  docstrings for calling conventions without a live test.
- Backend signs `create_competition`/`fund_competition`/`claim_reward` with
  the REQUESTING USER's own decrypted custodial key (not the operator) — real
  money moves from/to the person who owns it. `services/genlayer.ts` has
  `createCompetitionAsUser`, `fundCompetitionOnChain`, `claimRewardOnChain`.
- `finalize_competition`/`close_submissions` now allow creator-OR-admin (not
  admin-only) — `_require_creator_or_admin(comp)` — so any host can end their
  own arena without waiting on an admin, per explicit user request.
- **Known deploy-time quirk**: some deploy paths (raw RPC via genlayer-js,
  NOT the Studio UI) present a zero `gl.message.sender_address` to `__init__`
  AND silently drop constructor args/kwargs — confirmed by testing both.
  Fix added: `claim_initial_owner()` write method — a normal (non-constructor)
  call, where sender_address has been 100% reliable throughout this whole
  project. If `self.owner` is still the zero address, the first caller of
  `claim_initial_owner()` becomes owner/admin; no-ops (raises) once a real
  owner is set. Deploying via Studio UI (as the user did for the current
  address) resolves sender correctly and doesn't need this bootstrap — it's
  a safety net for RPC-based deploys only.
- **Not yet end-to-end value-tested against the live contract**: syntax is
  proven correct (throwaway test contract: payable fund + emit-transfer both
  returned `execution_result: SUCCESS`), and reads-after-write can lag by a
  few seconds (same pattern as the judging-sweep fix — poll before trusting
  a read right after a write). But no custodial app wallet holds any real
  GEN yet, so a full fund→judge→finalize→claim round trip with actual
  balance movement hasn't been observed. Needs: send a small amount of GEN
  from the funded Studio account into an app user's custodial wallet, then
  run the flow for real.

## Gotchas
- genlayer-js v0.10.0 is ESM-only, no `studionet` chain export → loaded via
  dynamic import(); StudioNet = `localnet` chain shape + hosted endpoint.
- genlayer-js `readContract` results are `Map`s → normalized via `toPlain()`
  in `backend/src/services/genlayer.ts`.
- Admin promotion is via `ADMIN_EMAILS` env at registration time (app-level
  admin ≠ contract-level admin; the latter needs `add_admin` on-chain, see above).
- Contract method args must stay primitives/strings (dates passed as ISO
  strings because the chain has no clock).
- A GenLayer tx can be consensus-ACCEPTED while its LEADER execution errored
  — always check `receipt.consensus_data.leader_receipt.execution_result`,
  not just tx status.

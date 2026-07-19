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

## Lifecycle automation (backend, UTC)
- Mon 00:05 rollover (opens the new official `week-YYYY-WW` arena on-chain)
- **Exact-time close**: each arena gets its own `setTimeout` armed at
  creation (and re-armed for every open arena on backend restart via
  `armPendingCloseTimers()`) that fires `close_submissions` the instant
  `endsAt` hits — closes land within ~1-2s of deadline, verified live.
- Every-minute fallback sweep, split into two INDEPENDENT single-flight
  guards (`closeRunning` / `judgeRunning`) so one never blocks the other:
  - close tick — catches any arena whose exact timer was lost to a restart
  - judge tick — judges up to 10 pending submissions (one arena's worth at
    a time, strictly sequential — a submission is fully finalized on-chain
    before the next is even sent) + finalizes fully-judged arenas
  Before this split, a long judging run on one arena could block the CLOSE
  step for a different, already-expired arena — letting it keep accepting
  submissions past its deadline. Confirmed fixed live with two arenas
  closing ~30s apart.

## Deployment status
- [x] Repo: https://github.com/zoefunds/Meme-olympics (no Claude attribution)
- [x] Contract deployed to StudioNet (CURRENT): `0x4EA07970855FeA17567693103610A25cd25aD159`
      (owner/deployer: the user's own wallet, deployed via Studio UI — the
      user deploys the contract themselves every time, never me).
      Supports REAL GEN value transfer, creator-can-finalize, permissionless
      competition creation/funding, vision-based judging, and a 1-submission-
      per-user-per-arena cap (backend + `set_competition_defaults(3, 1)`).
      Prior addresses (superseded, kept for history): 0xC31D...9224,
      0x9F64...52Ee, 0xADC1...a877, 0xE96f...A571A, 0x3E57...7244 — each
      redeployed by the user to clear test-data or add a feature.
- [x] Fly deploy live at meme-olympics-api.fly.dev, GENLAYER_CONTRACT_ADDRESS
      updated to the current address above.
- [x] Vercel deploy live at meme-olympics.vercel.app.
- [x] Backend operator (`0x4A6666C015BE347799E0B25cfE27bfd3847027BB`) has
      been granted `add_admin` on the current contract — automated
      close/judge/finalize is fully live.
- **Standing rule**: the user deploys the contract themselves via Studio
  every time ("I will be the one to deploy the contract") — I prepare/fix
  the contract file and hand off; I never deploy it. After each new
  address, the user must re-run `add_admin(<operator address>)` since
  contract-level admin doesn't carry over across redeploys.

## Vision-based judging (added — read before touching the judging prompt)
- The contract fetches the submission's actual image bytes (already doing
  the fetch for reachability) and passes them to
  `gl.nondet.exec_prompt(prompt, response_format="json", images=[body])` —
  genuine visual input, not just a URL string in the prompt text.
- **Type-stub trap**: the runtime's own type stubs advertise a singular
  `image=` kwarg for JSON-mode calls, but the actual implementation only
  ever reads `images=` (plural, list) regardless of `response_format`.
  Passing `image=` singular is silently a no-op — confirmed by testing on
  the pinned runner, not by trusting the stubs.
- Proven with two throwaway-contract tests before touching production: a
  solid-color image correctly identified by color, and a real meme
  ("Woman Yelling at Cat") correctly described in detail with zero textual
  hints available. Then verified end-to-end in production with a zero-hint
  test image whose evaluation summary correctly described its actual
  visual content (a plain blue triangle).
- The plagiarism-detection task now reasons from actual visual evidence
  (watermarks, screenshot chrome, pixel-identical duplication) instead of
  only URL/filename patterns.

## Real GEN value transfer (added — read before touching money paths)
- Contract methods: `create_competition` and `fund_competition` are
  `@gl.public.write.payable` — GEN sent as tx `value` becomes/adds-to that
  competition's real escrowed `prize_pool_atto` (the contract's own native
  balance backs it, readable via `self.balance` / `get_contract_info().contract_gen_balance_atto`).
  `claim_reward()` is self-serve: caller pulls their full `reward_balances_atto`
  to their own wallet via a genuine on-chain transfer.
- **THE REAL FIX (confirmed by live testing with real funded accounts,
  after extensive false starts — read this before touching payout code)**:
  `gl.get_contract_at(addr).emit_transfer(...)` — in EVERY calling
  convention tried (chained `.emit(value=X).emit_transfer()`, direct
  `.emit_transfer(value=X, on=...)` keyword form matching genvm's own docs
  AND a working reference project's exact code, `gl.chain.Account`,
  `gl.Account`, `gl.send`, `gl.transfer`) — **only delivers value to a
  deployed CONTRACT address. It fails against a plain wallet (EOA)**,
  which is what every custodial wallet is, either with an explicit
  `"Contract <addr> not found"` error or a silent no-op (zero triggered
  transactions, no balance change, no error). Proven with a control test:
  identical code succeeds and moves real value when the destination is a
  contract, fails every time when the destination is a wallet.
  **The mechanism that actually works**: an `@gl.evm.contract_interface`
  stub, routed through GenLayer's EVM-compatibility layer instead of the
  native `get_contract_at` lookup:
  ```python
  @gl.evm.contract_interface
  class _Recipient:
      class View: pass
      class Write: pass

  def _send_gen(self, to_address: str, amount: u256) -> None:
      _Recipient(Address(to_address)).emit_transfer(value=amount)
  ```
  Confirmed live: wallet balance increased by exactly the transferred
  amount. This is now the ONLY payout mechanism in the contract — every
  transfer routes through `_send_gen`, no other code path calls
  `emit_transfer` directly. Source: a working reference project
  (`~/Event-Weaver`, shared by a contact) uses this exact pattern for its
  escrow payouts — note Event Weaver's own test suite only asserts its
  internal ledger (`get_balance_of`), never a real wallet balance, so its
  "verified" claim didn't actually prove this either; only live-network
  testing with real funded accounts does.
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
- Reads-after-write can lag by several seconds on this network (same
  pattern hit repeatedly: judging sweep, finalization winners, wallet
  balance after claim) — always poll before trusting a read that
  immediately follows a write. `readSettled()` / `waitForWalletIncrease()`
  in `genlayer.ts` exist for exactly this.
- claim_reward end-to-end (fund → judge → finalize → claim → real wallet
  balance increase) is now proven working with the `_send_gen`/EVM-interface
  fix — pending a fresh contract deploy + backend rewire to pick it up.

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

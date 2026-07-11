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
- [ ] Contract deployed to StudioNet → set `GENLAYER_CONTRACT_ADDRESS` +
      `GENLAYER_OPERATOR_PRIVATE_KEY` in Fly secrets (Phase 11)
- [ ] Fly deploy (`cd backend && fly launch/deploy`, attach Postgres, set secrets)
- [ ] Vercel deploy (`cd frontend && vercel --prod`, set NEXT_PUBLIC_API_URL)

## Gotchas
- genlayer-js v0.10.0 is ESM-only, no `studionet` chain export → loaded via
  dynamic import(); StudioNet = `localnet` chain shape + hosted endpoint.
- Admin promotion is via `ADMIN_EMAILS` env at registration time.
- Contract method args must stay primitives/strings (dates passed as ISO
  strings because the chain has no clock).

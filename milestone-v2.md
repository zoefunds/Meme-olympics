# Milestone v2 — Team Review Changelog

This documents everything changed since the last milestone review, in the
order the underlying issues were actually found and fixed. Original
staff feedback that kicked this off:

> Thank you for your contribution to the GenLayer ecosystem. A neutral
> verdict is a good use case for evaluating contributions to an
> open-source project. However, using funding via GEN tokens is not
> realistic for practical application.

Two threads followed from that: (1) make the judging rubric itself more
rigorous, and (2) replace GEN-denominated funding with something a real
user would actually use. Both are done, plus a wallet-identity rework and
a run of production bugs found and fixed while dogfooding the result.

---

## 1. Judging rubric: hard gates + tighter consensus

**Contract:** [contracts/meme_olympics.py](contracts/meme_olympics.py)

- **New hard eligibility gate**, checked *before* any criteria scoring.
  The judge now first decides whether a submission is even a real meme
  entry (not blank, not spam, not unrelated content) — an ineligible entry
  scores 0 regardless of what the per-axis numbers say. Both leader and
  validator must agree on eligibility, and this gate is checked before
  plagiarism/score/criteria — no amount of axis agreement below can rescue
  a mismatch here.
- **Tightened validator-consensus tolerances**, which review found too
  loose (a leader and validator could disagree on nearly a third of the
  total score band and still reach consensus):
  - Total score tolerance: `±15` → `±10` (out of 100)
  - Per-criterion tolerance: `±5` → `±3` (out of 10)
  - Required per-criterion agreement: `7 of 9` → `8 of 9`
  - Plagiarism-confidence tolerance (`±35`, declared but never actually
    enforced before): now genuinely wired into the consensus gate — when
    either side flags anything but a clean "original", the two confidence
    numbers must be within `±25` of each other, not just cross the same
    disqualification threshold independently.
- New `Submission.eligible` / `eligibility_reason` fields (storage is
  append-only per GenLayer rules, so these were added at the end); a
  rejected-for-ineligibility submission gets its own status
  (`SUB_STATUS_REJECTED`) distinct from `SUB_STATUS_DISQUALIFIED`
  (plagiarism/unreachable image) — "wasn't a real meme" reads differently
  from "was a meme but broke the rules."

## 2. Payment architecture: GEN escrow → USDC on Base Sepolia

Direct response to the "GEN funding isn't realistic" feedback. GenLayer is
now **adjudication only** — it never escrows or moves value. Real prize
money is USDC on a separate chain.

- **New contract:** [contracts/base/MemeOlympicsEscrow.sol](contracts/base/MemeOlympicsEscrow.sol)
  — deployed on Base Sepolia, ~200 lines, no external dependencies. Hosts
  deposit USDC per competition; a backend relayer pushes GenLayer's
  finalized winners list once (idempotent — the contract itself refuses a
  second `setWinners` call for the same competition id); winners self-claim
  via a pull pattern (`claim`/`claimMany`) with checks-effects-interactions
  and a reentrancy guard. The backend never custodies a winner's USDC.
- **Contract-side changes:** `prize_pool_atto`/native-GEN escrow fields
  deprecated in place (storage stays append-only-compatible); new
  `prize_pool_usdc` (declared amount, informational) and `relay_tx_hash`
  fields. `create_competition`/`fund_competition` no longer accept a
  payable value — they record a declared USDC amount only.
  `claim_reward`/`_send_gen`/the `_Recipient` EVM stub are gone entirely,
  replaced by `mark_prizes_relayed` (an idempotency marker the relayer
  calls after its Base Sepolia tx confirms — moves no value on GenLayer).
- **Backend relayer:** [backend/src/services/baseSepolia.ts](backend/src/services/baseSepolia.ts)
  talks to the escrow contract; [backend/src/jobs/weekly.ts](backend/src/jobs/weekly.ts)
  relays winners right after finalize, plus a dedicated retry sweep every
  2 minutes on its own lock (so a slow Base Sepolia RPC can never block
  judging or closing).
- **Frontend:** hosting an arena now walks through approve + deposit USDC
  on Base Sepolia right after creation; the Rewards page claims directly
  from the escrow via the winner's own wallet.

## 3. Wallet-connect auth (replacing email + password)

Prompted by a direct product decision mid-build: no email, no password,
identity is the connected wallet.

- **New auth flow:** `GET /api/auth/nonce` issues a one-time message;
  `POST /api/auth/wallet-login` verifies the signature (`ethers.verifyMessage`)
  and signs the caller in, creating an account on first connect. See
  [backend/src/routes/auth.ts](backend/src/routes/auth.ts).
- Dropped entirely: `passwordHash`, `email`, `emailVerified`, the
  `PasswordResetToken` and `NotificationLog` tables, the Brevo email
  service, `bcryptjs`. Admin is now granted per-wallet (`ADMIN_WALLETS`
  env var), auto-applied on first connect, replacing email-based
  promotion.
- **First pass mistakenly kept a separate custodial signer** — a key
  auto-generated per account purely to sign GenLayer writes, since
  GenLayer's JS SDK appeared to require a raw private key. Reviewing a
  reference implementation ([Event-Weaver](https://github.com)) showed
  `genlayer-js` actually supports passing just an **address** to
  `createClient`, which delegates signing to the injected wallet directly.
  Custodial signer removed entirely in a follow-up pass — see
  [frontend/src/lib/genlayer.ts](frontend/src/lib/genlayer.ts). One wallet
  now signs literally everything: login, GenLayer writes, Base Sepolia
  transactions.
- `User.walletAddress`/`encryptedPrivateKey` dropped from the schema;
  `authAddress` (the connected wallet) is the only identity field.
- **Optional display username** added on top — settable from Settings via
  `PATCH /api/auth/me`, purely cosmetic (shown instead of a shortened
  address on leaderboards/submissions/dashboard), never used for login.

### Fallout from removing Reown/WalletConnect

Wallet connection was briefly built on Reown AppKit + wagmi (per a
request to use a specific WalletConnect project id). In production
testing the modal never actually opened — zero WalletConnect network
calls fired even after `.open()` — and the dependency pulled in ~300
packages including several optional connector SDKs (`@x402/*`,
`porto`, `@metamask/connect-evm`) that broke the Next.js build until
each was individually stubbed or installed. Dropped entirely in favor of
the same plain `window.ethereum` EIP-1193 approach already proven working
in Event-Weaver — smaller, and it actually works. Bundle size for
wallet-touching pages dropped from ~540KB to ~200KB as a side effect.

## 4. Moving GenLayer writes from backend-signed to wallet-signed

Follow-on from the custodial-key removal: every GenLayer write that used
to be signed server-side with a decrypted custodial key (submit meme,
create/open arena, open dispute) now happens **client-side**, signed by
the connected wallet, using the same `genlayer-js` address-based signing
trick.

- Backend routes changed shape from *"sign it and write it in one
  request"* to **register → wallet-signed write (frontend) → confirm**:
  `POST /api/competitions`, `POST /api/submissions`, `POST /api/disputes`
  now just create a pending DB row; the frontend sends the actual
  GenLayer transaction itself; a new `POST .../:id/onchain-confirm` on
  each resource reads GenLayer back to verify before flipping status —
  never trusting the client's word for it.
- `createCompetitionAsUser`, `openCompetitionAsUser`, `fundCompetitionOnChain`,
  `submitMemeOnChain`, `openDisputeOnChain`, and the retry sweeps that
  depended on holding a user's key (`retrySubmissionRegistrationSweep`,
  `retryDisputeRegistrationSweep`) are gone — the backend genuinely cannot
  sign on a user's behalf anymore, by construction.
- Backend keeps only operator-signed calls: judging (`evaluate_submission`),
  closing/finalizing, dispute resolution, and prize relay marking — things
  a host or submitter genuinely can't do themselves.

## 5. Bugs found and fixed while dogfooding

Each of these was caught by actually running the app end-to-end after
the changes above, not by inspection — noted here because the pattern
(not just the fix) is worth remembering.

### 5.1 — `open_competition` routed through the operator instead of the host
Every user-hosted arena's `open_competition` call was being signed by the
backend's operator wallet instead of the host's own wallet, even though
the contract already permits the creator to open their own competition.
Silently worked *only* for arenas the operator itself created (the
official weekly arena), and failed for every user-hosted one whenever the
operator wasn't also a contract admin. Fixed by routing both
`create_competition` and `open_competition` through the same host-signed
call — the operator is now never involved in a user's own arena at all.

### 5.2 — Operator loses admin on every contract redeploy
`add_admin` is scoped to a specific deployed contract instance; a fresh
GenLayer deploy resets the admin list to just the new owner. Hit this
**twice** in this milestone (once per redeploy) — each time, every
operator-signed action failed with `Only admin may call this` until the
owner key called `add_admin(<operator address>)` again. Documented as a
required deploy step in the README and in `contracts/README` notes;
not yet automated (would need the owner key held somewhere the deploy
pipeline can reach, which is its own tradeoff).

### 5.3 — Read-after-write lag silently skipped the USDC deposit step
The new `onchain-confirm` endpoints (§4) read GenLayer back immediately
after a write reached `ACCEPTED`. GenLayer reads can lag momentarily right
after a write lands — already a known pattern elsewhere in this codebase
(`readSettled`), but missed in these three new endpoints. When the read
failed on its first attempt, it threw, and — because the USDC deposit
step was sequenced *after* the confirm call in the same `try` block — the
deposit code was never reached at all. The arena would end up correctly
created and open on GenLayer, with prize money declared but never
actually deposited, and no visible error explaining why. Fixed with
`readUntilFound` (up to 6 retries, 3s apart) used by all three
`onchain-confirm` routes. Two already-affected arenas were reconciled
by hand in production after the fix shipped.

### 5.4 — Two Fly machines double-triggering every cron tick
Running 2 machines for 24/7 uptime meant each one independently fired the
exact same in-process `node-cron` schedule — every close/evaluate/finalize
call ran twice, once per machine. The existing single-flight guards
(`closeRunning`/`judgeRunning`/`relayRunning` booleans) only protected
against re-entrancy *within* one process, not across machines. Fixed with
a Redis-backed distributed lock ([`withLock`](backend/src/lib/redis.ts))
around every cron tick (close, judge, relay, weekly rollover) — self-
renewing at half its TTL for as long as the tick is running (judging can
legitimately take minutes per submission), released immediately on
completion, and **fails closed** (skip the tick) if Redis is unreachable,
the opposite of this codebase's usual Redis-frugal fail-open policy —
deliberately, since a missed tick self-heals next minute but a
silently-unlocked tick reintroduces the double-trigger bug.

### 5.5 — "Declared but not relayed" message never clears after a successful claim
`declaredUsdc` (GenLayer's cumulative all-time ledger) never decrements
when a winner claims on Base Sepolia — only the escrow's own claimable
balance drops to 0. The Rewards page inferred "pending relay" from
`declared > claimable`, so that delta persisted **permanently** after any
successful claim, even though everything was actually paid out. Fixed by
tracking relay status properly instead of inferring it: a new
`Competition.relayTxHash` column mirrors GenLayer's own relay marker, and
`pendingRelayUsdc` is now computed per-win from each competition's actual
relay status, not a cumulative-ledger comparison that can't tell "not yet
relayed" apart from "relayed and fully claimed."

## 6. New UI

- **Winner detail on the arena page** — the Winners section on
  `/arenas/:id` used to show only an address, rank, and score. It now
  shows each winner's actual meme image, title, the validators' written
  judging summary, a full per-criterion score breakdown, and the
  plagiarism verdict — the same depth of detail as the individual
  consensus report, surfaced right on the arena page.
- **Username registration** — Settings gained a display-name field
  (`PATCH /api/auth/me`), shown everywhere a wallet address used to be
  the only option.

## 7. Infrastructure

- Backend scaled to 2 Fly machines for redundancy (made safe by §5.4's
  fix — was previously silently broken with 2 machines).
- Production database fully reset for this milestone (all users,
  competitions, submissions, images cleared) to start testing clean
  against the redeployed GenLayer contract.
- New migrations: `authAddress`/wallet-auth fields, dropped
  email/password columns, dropped custodial-wallet columns, added
  `Competition.relayTxHash`.

## 8. Fund an existing arena

Added a "Fund This Arena" card to `/arenas/:id` (visible to any connected
user while the arena is `open` or `judging`), closing the gap noted below:
enter an amount, confirm `fund_competition` on GenLayer (wallet-signed),
then approve + deposit the matching USDC on the Base Sepolia escrow — the
same flow already used for prize pools at arena-creation time, just
callable later by anyone (host, sponsor, or community), not only at
hosting time.

## What's still manual / not automated

- **`add_admin` after a GenLayer redeploy** (§5.2) — the contract owner
  must re-grant the operator admin by hand every time the contract is
  redeployed. Worth automating as part of a deploy script if redeploys
  become frequent.

/**
 * GenLayer integration layer.
 *
 * Wraps genlayer-js so the rest of the backend never touches chain plumbing.
 * genlayer-js is ESM-only, so it is loaded lazily via dynamic import() —
 * safe from this CommonJS build on Node >= 20.
 *
 * StudioNet is addressed by pointing the localnet chain definition at the
 * hosted Studio RPC endpoint (GENLAYER_RPC_URL). All methods raise clear
 * errors until GENLAYER_CONTRACT_ADDRESS / operator key are configured —
 * Phase 11 activation happens purely via env vars.
 */
import { config } from "../lib/config";
import { logger } from "../lib/logger";

/* eslint-disable @typescript-eslint/no-explicit-any */
type GLClient = any;

let glModule: any | null = null;
let chainDef: any | null = null;
let operatorClient: GLClient | null = null;

async function loadSdk() {
  if (!glModule) {
    glModule = await import("genlayer-js");
    const chains: any = await import("genlayer-js/chains");
    // StudioNet = localnet chain shape served at the hosted Studio endpoint.
    chainDef = {
      ...chains.localnet,
      rpcUrls: {
        default: { http: [config.genlayer.rpcUrl] },
      },
    };
  }
  return glModule;
}

function contractAddress(): `0x${string}` {
  if (!config.genlayer.contractAddress) {
    throw new Error("GENLAYER_CONTRACT_ADDRESS is not configured yet");
  }
  return config.genlayer.contractAddress as `0x${string}`;
}

async function getOperatorClient(): Promise<GLClient> {
  const sdk = await loadSdk();
  if (!operatorClient) {
    if (!config.genlayer.operatorPrivateKey) {
      throw new Error("GENLAYER_OPERATOR_PRIVATE_KEY is not configured");
    }
    const account = sdk.createAccount(config.genlayer.operatorPrivateKey);
    operatorClient = sdk.createClient({
      chain: chainDef,
      endpoint: config.genlayer.rpcUrl,
      account,
    });
  }
  return operatorClient;
}

export function isChainConfigured(): boolean {
  return Boolean(
    config.genlayer.contractAddress && config.genlayer.operatorPrivateKey
  );
}

async function waitAccepted(client: GLClient, hash: string) {
  const receipt = await client.waitForTransactionReceipt({
    hash,
    status: "ACCEPTED",
    interval: 5000,
    retries: 60,
  });
  // A GenLayer tx can be consensus-ACCEPTED while its execution errored
  // (e.g. a UserError raised in the contract). Check the LEADER receipt only —
  // idle-validator entries legitimately carry ERROR/cancellation records.
  const anyReceipt = receipt as any;
  let leader = anyReceipt?.consensus_data?.leader_receipt;
  if (Array.isArray(leader)) leader = leader[0];
  const execResult = leader?.execution_result ?? leader?.genvm_result?.status;
  if (typeof execResult === "string" && execResult.toUpperCase() === "ERROR") {
    const flat = JSON.stringify(leader, (_k, v) =>
      typeof v === "bigint" ? v.toString() : v instanceof Map ? Object.fromEntries(v) : v
    );
    let detail = /\[(EXPECTED|EXTERNAL|TRANSIENT|LLM_ERROR)\][^"\\]{0,150}/.exec(flat)?.[0];
    if (!detail && typeof leader?.result === "string") {
      // Leader result is base64-encoded calldata; the error text is inside.
      try {
        const decoded = Buffer.from(leader.result, "base64").toString("utf8");
        detail = /\[(EXPECTED|EXTERNAL|TRANSIENT|LLM_ERROR)\][^\n]{0,150}/.exec(decoded)?.[0];
      } catch {
        /* leave detail empty */
      }
    }
    throw new Error(
      `Transaction executed with ERROR${detail ? `: ${detail}` : ""} (${hash})`
    );
  }
  return receipt;
}

/**
 * Waits past ACCEPTED through to FINALIZED (the appeal window has closed).
 * Used for judging specifically: the caller wants submission N fully
 * settled on the explorer before submission N+1's evaluate tx is even
 * broadcast, not just consensus-accepted. Bounded — if finalization is slow
 * (network congestion), logs a warning and proceeds rather than blocking
 * the whole judging queue indefinitely.
 */
async function waitFinalized(client: GLClient, hash: string): Promise<void> {
  try {
    await client.waitForTransactionReceipt({
      hash,
      status: "FINALIZED",
      interval: 5000,
      retries: 60, // up to 5 minutes
    });
  } catch (err) {
    logger.warn(
      { hash, err: (err as Error).message },
      "tx did not reach FINALIZED within the wait window; proceeding anyway"
    );
  }
}

/** genlayer-js decodes calldata dicts as Maps — normalize to plain JSON. */
function toPlain(value: any): any {
  if (value instanceof Map) {
    const obj: Record<string, any> = {};
    for (const [k, v] of value) obj[String(k)] = toPlain(v);
    return obj;
  }
  if (Array.isArray(value)) return value.map(toPlain);
  if (typeof value === "bigint") return value.toString();
  return value;
}

export async function readContract(functionName: string, args: any[] = []) {
  const client = await getOperatorClient();
  const result = await client.readContract({
    address: contractAddress(),
    functionName,
    args,
  });
  return toPlain(result);
}

/** Retries only on rate-limit-shaped RPC errors, with exponential backoff —
 * keeps sequential operator writes (e.g. create_competition then
 * open_competition) under the network's 30 req/min ceiling. Any other
 * error rethrows immediately. */
async function withBackoff<T>(
  fn: () => Promise<T>,
  retries = 4,
  baseDelayMs = 1500
): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (attempt >= retries || !/rate.?limit/i.test(message)) throw err;
      await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** attempt));
      attempt++;
    }
  }
}

async function writeAs(
  client: GLClient,
  functionName: string,
  args: any[],
  value: bigint = BigInt(0),
  waitForFinal: boolean = false
): Promise<string> {
  const hash = await withBackoff(() =>
    client.writeContract({
      address: contractAddress(),
      functionName,
      args,
      value,
    })
  );
  logger.info({ functionName, hash, value: value.toString() }, "genlayer tx sent");
  await waitAccepted(client, hash as string);
  if (waitForFinal) await waitFinalized(client, hash as string);
  return hash as string;
}

/**
 * Reads right after a write can lag the just-accepted state (same
 * "accepted-but-not-yet-readable" behavior we already handle in the judging
 * sweep). Poll until the predicate is satisfied or we give up.
 */
export async function readSettled<T>(
  functionName: string,
  args: any[],
  isSettled: (v: T) => boolean,
  retries = 8,
  delayMs = 4000
): Promise<T> {
  let value = (await readContract(functionName, args)) as T;
  for (let i = 0; i < retries && !isSettled(value); i++) {
    await new Promise((r) => setTimeout(r, delayMs));
    value = (await readContract(functionName, args)) as T;
  }
  return value;
}

/**
 * Same "accepted-but-not-yet-readable" lag as readSettled, but for reads
 * that RAISE (e.g. get_competition/get_submission/get_dispute all throw
 * "not found" via the contract's own UserError) rather than returning a
 * partial value — retries on the exception itself, and optionally on a
 * predicate over the value once found (e.g. waiting for status to catch up
 * to a second write). Returns null if it never settles. Used by the
 * *_confirm routes: the frontend's write just reached ACCEPTED, but a read
 * moments later can still 404 or show stale state briefly.
 */
export async function readUntilFound<T>(
  functionName: string,
  args: any[],
  isSettled: (v: T) => boolean = () => true,
  retries = 6,
  delayMs = 3000
): Promise<T | null> {
  for (let i = 0; i <= retries; i++) {
    try {
      const value = (await readContract(functionName, args)) as T;
      if (isSettled(value)) return value;
    } catch {
      /* not found yet — fall through to retry */
    }
    if (i < retries) await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}

// ---------- Operator (admin) transactions ----------

/** Used only for the automated official weekly arena — always
 * prizePoolUsdc=0. Anyone-hosted arenas are created and opened by the HOST'S
 * OWN connected wallet directly from the frontend (see frontend/lib/genlayer.ts)
 * — this backend holds no user private keys. */
export async function createCompetitionOnChain(
  id: string,
  title: string,
  theme: string,
  startsAt: string,
  endsAt: string
): Promise<string> {
  return writeAs(await getOperatorClient(), "create_competition", [
    id,
    title,
    theme,
    startsAt,
    endsAt,
    0,
  ]);
}

/** Admin/relayer-only: record that a finalized competition's winners were
 * pushed to the Base Sepolia escrow (services/baseSepolia.ts) and that
 * transaction confirmed. Moves no value on this chain. */
export async function markPrizesRelayedOnChain(
  competitionId: string,
  relayTxHash: string
): Promise<string> {
  return writeAs(await getOperatorClient(), "mark_prizes_relayed", [
    competitionId,
    relayTxHash,
  ]);
}

/** Used only for the operator's own arenas (the official weekly rollover) —
 * the operator is the creator in that case, so it's entitled to open it. */
export async function openCompetitionOnChain(id: string): Promise<string> {
  return writeAs(await getOperatorClient(), "open_competition", [id]);
}

/** Defense-in-depth for the 1-submission-per-user cap already enforced in
 * the backend (submissions.ts): sets the contract's own per-user ceiling to
 * match, so the on-chain rule agrees with the DB rule. winnerCount stays
 * whatever the contract's existing default is unless overridden. */
export async function setCompetitionDefaultsOnChain(
  winnerCount: number,
  maxSubmissionsPerUser: number
): Promise<string> {
  return writeAs(await getOperatorClient(), "set_competition_defaults", [
    winnerCount,
    maxSubmissionsPerUser,
  ]);
}

export async function closeSubmissionsOnChain(id: string): Promise<string> {
  return writeAs(await getOperatorClient(), "close_submissions", [id]);
}

export async function finalizeCompetitionOnChain(
  id: string,
  finalizedAt: string
): Promise<string> {
  return writeAs(await getOperatorClient(), "finalize_competition", [
    id,
    finalizedAt,
  ]);
}

export async function evaluateSubmissionOnChain(
  submissionId: string
): Promise<string> {
  // waitForFinal=true: judging must be strictly sequential on the explorer —
  // this submission reaches FINALIZED before the judging sweep's loop moves
  // on to broadcast the next submission's evaluate tx.
  return writeAs(
    await getOperatorClient(),
    "evaluate_submission",
    [submissionId],
    BigInt(0),
    true
  );
}

export async function resolveDisputeOnChain(
  disputeId: string,
  resolvedAt: string
): Promise<string> {
  return writeAs(await getOperatorClient(), "resolve_dispute", [
    disputeId,
    resolvedAt,
  ]);
}

// ---------- Reads ----------

export async function getOnchainSubmission(submissionId: string) {
  return readContract("get_submission", [submissionId]);
}

export async function getOnchainCompetition(competitionId: string) {
  return readContract("get_competition", [competitionId]);
}

export async function getOnchainLeaderboard(competitionId: string) {
  return readContract("get_leaderboard", [competitionId]);
}

/** Declared USDC (base units) an address is owed across all won
 * competitions, per GenLayer's own bookkeeping. Informational only — real,
 * claimable USDC lives on the Base Sepolia escrow contract; use
 * services/baseSepolia.ts's getEscrowClaimable for the actual claimable
 * amount once a competition has been relayed. */
export async function getDeclaredReward(address: string) {
  return readContract("get_declared_reward", [address]);
}

export async function getContractInfo() {
  return readContract("get_contract_info", []);
}

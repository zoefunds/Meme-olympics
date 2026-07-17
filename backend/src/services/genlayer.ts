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

/** Client bound to a specific user's custodial wallet key. */
async function getUserClient(privateKey: string): Promise<GLClient> {
  const sdk = await loadSdk();
  const account = sdk.createAccount(privateKey);
  return sdk.createClient({
    chain: chainDef,
    endpoint: config.genlayer.rpcUrl,
    account,
  });
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

async function writeAs(
  client: GLClient,
  functionName: string,
  args: any[],
  value: bigint = BigInt(0)
): Promise<string> {
  const hash = await client.writeContract({
    address: contractAddress(),
    functionName,
    args,
    value,
  });
  logger.info({ functionName, hash, value: value.toString() }, "genlayer tx sent");
  await waitAccepted(client, hash as string);
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

// ---------- Operator (admin) transactions ----------

/** Used only for the automated official weekly arena — always value=0.
 * Anyone-hosted arenas go through createCompetitionAsUser instead so the
 * real GEN prize pool comes from the actual host's own wallet. */
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
  ]);
}

// ---------- User-signed value-transfer transactions ----------

/** Creates a competition signed by the HOST's own wallet. `prizeAtto` (may
 * be 0 for a prestige-only arena) is sent as real GEN value and becomes the
 * competition's escrowed, on-chain prize pool. */
export async function createCompetitionAsUser(
  userPrivateKey: string,
  id: string,
  title: string,
  theme: string,
  startsAt: string,
  endsAt: string,
  prizeAtto: bigint
): Promise<string> {
  return writeAs(
    await getUserClient(userPrivateKey),
    "create_competition",
    [id, title, theme, startsAt, endsAt],
    prizeAtto
  );
}

/** Anyone (host, sponsor, community member) can top up a competition's
 * real GEN prize pool with their own wallet before it finalizes. */
export async function fundCompetitionOnChain(
  userPrivateKey: string,
  competitionId: string,
  amountAtto: bigint
): Promise<string> {
  return writeAs(
    await getUserClient(userPrivateKey),
    "fund_competition",
    [competitionId],
    amountAtto
  );
}

/** Winner pulls their claimable GEN reward balance to their own wallet.
 * This is a genuine on-chain native-currency transfer out of the contract's
 * own escrowed balance, not an internal points ledger. */
export async function claimRewardOnChain(userPrivateKey: string): Promise<string> {
  return writeAs(await getUserClient(userPrivateKey), "claim_reward", []);
}

export async function openCompetitionOnChain(id: string): Promise<string> {
  return writeAs(await getOperatorClient(), "open_competition", [id]);
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
  return writeAs(await getOperatorClient(), "evaluate_submission", [submissionId]);
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

// ---------- User-signed transactions (custodial wallet) ----------

export async function submitMemeOnChain(
  userPrivateKey: string,
  competitionId: string,
  submissionId: string,
  title: string,
  caption: string,
  imageUrl: string,
  contextUrl: string,
  tagsJson: string,
  submittedAt: string
): Promise<string> {
  return writeAs(await getUserClient(userPrivateKey), "submit_meme", [
    competitionId,
    submissionId,
    title,
    caption,
    imageUrl,
    contextUrl,
    tagsJson,
    submittedAt,
  ]);
}

export async function openDisputeOnChain(
  userPrivateKey: string,
  disputeId: string,
  submissionId: string,
  reason: string,
  evidenceUrl: string,
  openedAt: string
): Promise<string> {
  return writeAs(await getUserClient(userPrivateKey), "open_dispute", [
    disputeId,
    submissionId,
    reason,
    evidenceUrl,
    openedAt,
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

export async function getOnchainRewardBalance(address: string) {
  return readContract("get_reward_balance", [address]);
}

export async function getContractInfo() {
  return readContract("get_contract_info", []);
}

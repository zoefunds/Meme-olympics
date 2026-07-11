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
  return client.waitForTransactionReceipt({
    hash,
    status: "ACCEPTED",
    interval: 5000,
    retries: 60,
  });
}

export async function readContract(functionName: string, args: any[] = []) {
  const client = await getOperatorClient();
  return client.readContract({
    address: contractAddress(),
    functionName,
    args,
  });
}

async function writeAs(
  client: GLClient,
  functionName: string,
  args: any[]
): Promise<string> {
  const hash = await client.writeContract({
    address: contractAddress(),
    functionName,
    args,
    value: BigInt(0),
  });
  logger.info({ functionName, hash }, "genlayer tx sent");
  await waitAccepted(client, hash as string);
  return hash as string;
}

// ---------- Operator (admin) transactions ----------

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

/**
 * Base Sepolia payment layer.
 *
 * GenLayer (services/genlayer.ts) is the adjudication layer only — it never
 * escrows or moves real value. Real USDC prize pools live in
 * MemeOlympicsEscrow (contracts/base/MemeOlympicsEscrow.sol) on Base
 * Sepolia. This module is the only place that talks to that contract:
 * turning a GenLayer competition_id into the escrow's bytes32 key, and
 * relaying a finalized competition's winners list once.
 */
import { ethers } from "ethers";
import { config } from "../lib/config";
import { logger } from "../lib/logger";
import { MEME_OLYMPICS_ESCROW_ABI, ERC20_ABI } from "../lib/escrowAbi";

let provider: ethers.JsonRpcProvider | null = null;
let relayerWallet: ethers.Wallet | null = null;
let escrowContract: ethers.Contract | null = null;

function getProvider(): ethers.JsonRpcProvider {
  if (!provider) {
    provider = new ethers.JsonRpcProvider(config.baseSepolia.rpcUrl);
  }
  return provider;
}

export function isEscrowConfigured(): boolean {
  return Boolean(
    config.baseSepolia.escrowAddress && config.baseSepolia.relayerPrivateKey
  );
}

function getRelayerContract(): ethers.Contract {
  if (!config.baseSepolia.escrowAddress) {
    throw new Error("MEME_OLYMPICS_ESCROW_ADDRESS is not configured");
  }
  if (!config.baseSepolia.relayerPrivateKey) {
    throw new Error("BASE_SEPOLIA_RELAYER_PRIVATE_KEY is not configured");
  }
  if (!escrowContract) {
    relayerWallet = new ethers.Wallet(
      config.baseSepolia.relayerPrivateKey,
      getProvider()
    );
    escrowContract = new ethers.Contract(
      config.baseSepolia.escrowAddress,
      MEME_OLYMPICS_ESCROW_ABI,
      relayerWallet
    );
  }
  return escrowContract;
}

/** Read-only contract instance, no signer required. */
function getReadContract(): ethers.Contract {
  if (!config.baseSepolia.escrowAddress) {
    throw new Error("MEME_OLYMPICS_ESCROW_ADDRESS is not configured");
  }
  return new ethers.Contract(
    config.baseSepolia.escrowAddress,
    MEME_OLYMPICS_ESCROW_ABI,
    getProvider()
  );
}

/** GenLayer competition ids are short strings (e.g. "week-2026-28"); the
 * escrow contract keys pools by bytes32, so we hash the id deterministically
 * the same way on both the backend and the frontend. */
export function competitionIdToBytes32(competitionId: string): string {
  return ethers.id(competitionId);
}

export interface OnchainWinner {
  submission_id: string;
  author: string;
  rank: number;
  score: number;
  reward_usdc: string;
}

/**
 * Push a settlement-eligible competition's winners onto Base Sepolia. A
 * retry after Base succeeds but GenLayer's marker fails reconciles the
 * existing allocation and returns its original receipt rather than calling
 * setWinners again (which the escrow correctly rejects as one-time only).
 */
export interface RelayResult {
  txHash: string;
  /** True when Base had already committed the exact allocation and this call
   * recovered its original transaction instead of attempting setWinners again. */
  reconciled: boolean;
}

async function findWinnersSetTransaction(
  contract: ethers.Contract,
  key: string
): Promise<string> {
  const logs = await contract.queryFilter(contract.filters.WinnersSet(key));
  const log = logs[logs.length - 1];
  if (!log?.transactionHash) {
    throw new Error("Escrow shows winners set but its WinnersSet receipt is not yet indexed; retry safely");
  }
  return log.transactionHash;
}

/** Prove an already-set allocation even if one or more winners claimed before
 * the GenLayer marker retry. The original transaction calldata is immutable
 * evidence of recipients/amounts; Claimed events account for balances that
 * have legitimately moved out of `claimable` since allocation. */
export async function reconcileExistingAllocation(
  contract: ethers.Contract,
  key: string,
  addresses: string[],
  amounts: bigint[],
  claimableAfter: bigint,
  allocated: bigint,
  existingClaimableAfter: bigint
): Promise<string> {
  const expectedTotal = amounts.reduce((sum, amount) => sum + amount, BigInt(0));
  if (allocated !== expectedTotal || existingClaimableAfter !== claimableAfter) {
    throw new Error("Existing Base allocation totals/deadline do not match finalized settlement");
  }

  const txHash = await findWinnersSetTransaction(contract, key);
  const txProvider = (contract.runner as ethers.ContractRunner | null)?.provider;
  if (!txProvider) throw new Error("Escrow provider unavailable for allocation reconciliation");
  const tx = await txProvider.getTransaction(txHash);
  if (!tx) throw new Error("Original Base allocation transaction is unavailable");
  const parsed = contract.interface.parseTransaction({ data: tx.data, value: tx.value });
  if (!parsed || parsed.name !== "setWinners") {
    throw new Error("Original Base allocation transaction is not setWinners");
  }
  const originalKey = String(parsed.args[0]).toLowerCase();
  const originalAddresses = Array.from(parsed.args[1] as string[]).map((v) => v.toLowerCase());
  const originalAmounts = Array.from(parsed.args[2] as bigint[]).map((v) => BigInt(v));
  const originalDeadline = BigInt(parsed.args[3]);
  if (
    originalKey !== key.toLowerCase() ||
    originalDeadline !== claimableAfter ||
    originalAddresses.length !== addresses.length ||
    originalAmounts.length !== amounts.length ||
    originalAddresses.some((address, i) => address !== addresses[i].toLowerCase()) ||
    originalAmounts.some((amount, i) => amount !== amounts[i])
  ) {
    throw new Error("Original Base allocation calldata does not match finalized settlement");
  }

  const expectedByAddress = new Map<string, bigint>();
  for (let i = 0; i < addresses.length; i++) {
    const address = addresses[i].toLowerCase();
    expectedByAddress.set(address, (expectedByAddress.get(address) || BigInt(0)) + amounts[i]);
  }
  for (const [address, expected] of expectedByAddress) {
    const [current, claimLogs] = await Promise.all([
      contract.getClaimable(key, address),
      contract.queryFilter(contract.filters.Claimed(key, address)),
    ]);
    let claimed = BigInt(0);
    for (const log of claimLogs) {
      const args = "args" in log && log.args
        ? log.args
        : contract.interface.parseLog({ topics: log.topics as string[], data: log.data })?.args;
      if (!args) throw new Error("Unable to decode Base claim evidence");
      claimed += BigInt(args.amount ?? args[2]);
    }
    if (BigInt(current) + claimed !== expected) {
      throw new Error("Existing Base winner balance plus claims does not match finalized settlement");
    }
  }
  return txHash;
}

export async function relayWinnersToEscrow(
  competitionId: string,
  winners: OnchainWinner[],
  claimableAfter: bigint
): Promise<RelayResult> {
  const contract = getRelayerContract();
  const nonZero = winners.filter((w) => BigInt(w.reward_usdc || "0") > BigInt(0));
  if (nonZero.length === 0) {
    throw new Error(`No non-zero rewards to relay for competition ${competitionId}`);
  }
  const addresses = nonZero.map((w) => w.author);
  const amounts = nonZero.map((w) => BigInt(w.reward_usdc));
  const key = competitionIdToBytes32(competitionId);

  // Recovery path for the dangerous partial-success window: Base may have
  // accepted setWinners just before GenLayer's marker write failed. Verify
  // the already-written allocation and recover its actual transaction hash;
  // never submit setWinners a second time.
  const [deposited, allocated, winnersSet, existingClaimableAfter] = await contract.getPool(key);
  if (winnersSet) {
    // Keep the read so provider/ABI errors are surfaced before we claim
    // reconciliation succeeded; deposited is intentionally not authoritative
    // once a pool has had withdrawals of unallocated funds.
    void deposited;
    return {
      txHash: await reconcileExistingAllocation(
        contract,
        key,
        addresses,
        amounts,
        claimableAfter,
        allocated as bigint,
        existingClaimableAfter as bigint
      ),
      reconciled: true,
    };
  }

  const tx = await contract.setWinners(key, addresses, amounts, claimableAfter);
  logger.info(
    { competitionId, txHash: tx.hash, winnerCount: addresses.length },
    "relaying winners to Base Sepolia escrow"
  );
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) {
    throw new Error(`setWinners transaction failed for competition ${competitionId}`);
  }
  return { txHash: tx.hash as string, reconciled: false };
}

export async function getEscrowPool(competitionId: string) {
  const contract = getReadContract();
  const key = competitionIdToBytes32(competitionId);
  const [deposited, allocated, winnersSet, claimableAfter] = await contract.getPool(key);
  return {
    deposited: (deposited as bigint).toString(),
    allocated: (allocated as bigint).toString(),
    winnersSet: winnersSet as boolean,
    claimableAfter: (claimableAfter as bigint).toString(),
  };
}

export async function getEscrowClaimable(competitionId: string, address: string) {
  const contract = getReadContract();
  const key = competitionIdToBytes32(competitionId);
  const amount = await contract.getClaimable(key, address);
  return (amount as bigint).toString();
}

/** The wallet's own real USDC balance on Base Sepolia (base units, 6
 * decimals) — distinct from declared/claimable prize money. Works even if
 * the escrow contract isn't configured yet, since it only needs the USDC
 * address and an RPC connection. */
export async function getWalletUsdcBalance(address: string): Promise<string> {
  const usdc = new ethers.Contract(
    config.baseSepolia.usdcAddress,
    ERC20_ABI,
    getProvider()
  );
  const balance = await usdc.balanceOf(address);
  return (balance as bigint).toString();
}

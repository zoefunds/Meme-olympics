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
 * Push a GenLayer-finalized competition's winners onto the Base Sepolia
 * escrow. Idempotent from the caller's perspective: the contract itself
 * rejects a second setWinners call for the same competitionId, so a retry
 * after a partial failure (e.g. the GenLayer mark_prizes_relayed call
 * failing after this succeeded) is safe to just call again.
 */
export async function relayWinnersToEscrow(
  competitionId: string,
  winners: OnchainWinner[]
): Promise<string> {
  const contract = getRelayerContract();
  const nonZero = winners.filter((w) => BigInt(w.reward_usdc || "0") > BigInt(0));
  if (nonZero.length === 0) {
    throw new Error(`No non-zero rewards to relay for competition ${competitionId}`);
  }
  const addresses = nonZero.map((w) => w.author);
  const amounts = nonZero.map((w) => BigInt(w.reward_usdc));
  const key = competitionIdToBytes32(competitionId);

  const tx = await contract.setWinners(key, addresses, amounts);
  logger.info(
    { competitionId, txHash: tx.hash, winnerCount: addresses.length },
    "relaying winners to Base Sepolia escrow"
  );
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) {
    throw new Error(`setWinners transaction failed for competition ${competitionId}`);
  }
  return tx.hash as string;
}

export async function getEscrowPool(competitionId: string) {
  const contract = getReadContract();
  const key = competitionIdToBytes32(competitionId);
  const [deposited, allocated, winnersSet] = await contract.getPool(key);
  return {
    deposited: (deposited as bigint).toString(),
    allocated: (allocated as bigint).toString(),
    winnersSet: winnersSet as boolean,
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

/** Read-only verification of the production GenLayer and Base deployments. */
import dotenv from "dotenv";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Contract, JsonRpcProvider, Wallet } from "ethers";
import { createAccount, createClient } from "genlayer-js";
import { localnet } from "genlayer-js/chains";

const local = dotenv.parse(readFileSync(resolve(process.cwd(), ".env")));
const production = dotenv.parse(readFileSync(resolve(process.cwd(), ".env.production")));
const genlayerAddress = required(production, "GENLAYER_CONTRACT_ADDRESS") as `0x${string}`;

function required(source: Record<string, string>, name: string) {
  const value = source[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function plain(value: any): any {
  if (value instanceof Map) return Object.fromEntries([...value].map(([k, v]) => [String(k), plain(v)]));
  if (Array.isArray(value)) return value.map(plain);
  if (typeof value === "bigint") return value.toString();
  return value;
}

async function main() {
  const endpoint = production.GENLAYER_RPC_URL || "https://studio.genlayer.com/api";
  const account = createAccount(required(production, "GENLAYER_OPERATOR_PRIVATE_KEY"));
  const gl = createClient({
    chain: { ...localnet, rpcUrls: { default: { http: [endpoint] } } },
    endpoint,
    account,
  });
  const info = plain(await gl.readContract({
    address: genlayerAddress,
    functionName: "get_contract_info",
    args: [],
  })) as Record<string, any>;
  const isAdmin = await gl.readContract({
    address: genlayerAddress,
    functionName: "is_admin",
    args: [account.address],
  });
  if (!isAdmin) throw new Error("Configured GenLayer operator is not a contract admin");
  if (String(info.owner || "").toLowerCase() !== account.address.toLowerCase()) {
    throw new Error("Configured GenLayer operator does not own the deployed contract");
  }

  const provider = new JsonRpcProvider(required(local, "BASE_SEPOLIA_RPC_URL"));
  const relayer = new Wallet(required(local, "BASE_SEPOLIA_RELAYER_PRIVATE_KEY"));
  const escrowAddress = required(local, "MEME_OLYMPICS_ESCROW_ADDRESS");
  const escrow = new Contract(escrowAddress, [
    "function owner() view returns (address)",
    "function relayer() view returns (address)",
    "function usdc() view returns (address)",
  ], provider);
  const [owner, configuredRelayer, usdc, code] = await Promise.all([
    escrow.owner(), escrow.relayer(), escrow.usdc(), provider.getCode(escrowAddress),
  ]);
  if (code === "0x") throw new Error("No bytecode at configured escrow address");
  if (owner.toLowerCase() !== relayer.address.toLowerCase()) throw new Error("Escrow owner mismatch");
  if (configuredRelayer.toLowerCase() !== relayer.address.toLowerCase()) throw new Error("Escrow relayer mismatch");
  if (usdc.toLowerCase() !== required(local, "BASE_SEPOLIA_USDC_ADDRESS").toLowerCase()) {
    throw new Error("Escrow USDC mismatch");
  }

  console.log(`GenLayer contract verified: ${genlayerAddress}`);
  console.log(`GenLayer owner/admin verified: ${account.address}`);
  console.log(`Base escrow verified: ${escrowAddress}`);
  console.log(`Base owner/relayer verified: ${relayer.address}`);
  console.log(`Base USDC verified: ${usdc}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

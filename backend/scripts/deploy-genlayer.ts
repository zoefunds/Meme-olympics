/**
 * Deploy the production GenLayer contract with the configured operator key.
 *
 * Usage (secrets belong in a local, gitignored env file or the deploy
 * platform; never pass a private key as a CLI argument):
 *   GENLAYER_OPERATOR_PRIVATE_KEY=... GENLAYER_RPC_URL=... \
 *   npm run deploy:genlayer
 *
 * The deployer becomes the contract owner/admin. Transfer ownership to the
 * production governance address immediately after deployment if it differs
 * from the operator, then add the operator back as admin before enabling the
 * worker.
 */
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createAccount, createClient } from "genlayer-js";
import { localnet } from "genlayer-js/chains";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

async function main() {
  const endpoint = process.env.GENLAYER_RPC_URL || "https://studio.genlayer.com/api";
  const account = createAccount(required("GENLAYER_OPERATOR_PRIVATE_KEY"));
  const code = await readFile(resolve(process.cwd(), "../contracts/meme_olympics.py"), "utf8");
  const client = createClient({
    chain: { ...localnet, rpcUrls: { default: { http: [endpoint] } } },
    endpoint,
    account,
  });
  const hash = await client.deployContract({
    code,
    // Explicitly sets a usable owner even on deployment paths where the
    // constructor context is not populated as expected.
    args: [account.address],
  });
  console.log(`GenLayer deployment submitted: ${hash}`);
  const receipt: any = await client.waitForTransactionReceipt({
    hash,
    status: "ACCEPTED",
    interval: 5_000,
    retries: 120,
  });
  const address = receipt?.txDataDecoded?.contractAddress || receipt?.recipient || receipt?.to_address;
  if (!address) throw new Error("Deployment accepted but contract address was not present in the receipt");
  console.log(`GENLAYER_CONTRACT_ADDRESS=${address}`);
  console.log("Wait for FINALIZED, then set this address in Fly and Vercel before enabling traffic.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

/** Safely imports production chain secrets into Fly via stdin.
 *
 * `fly secrets import` reads NAME=VALUE pairs from stdin, keeping private
 * keys out of process arguments and error messages. Run only after `fly auth
 * login` and with explicit production-change authorization.
 */
import dotenv from "dotenv";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

dotenv.config({ path: ".env" });
const productionEnv = existsSync(".env.production")
  ? dotenv.parse(readFileSync(".env.production"))
  : {};

const appName = process.env.FLY_APP_NAME || "meme-olympics-api-v2-gideon";
const escrowAddress = required("MEME_OLYMPICS_ESCROW_ADDRESS");
const chainOnly = process.argv.includes("--chain-only");

const requiredChainSecrets = [
  "BASE_SEPOLIA_RPC_URL",
  "BASE_SEPOLIA_USDC_ADDRESS",
  "BASE_SEPOLIA_RELAYER_PRIVATE_KEY",
] as const;

function required(name: string, preferProduction = false): string {
  const value = getValue(name, preferProduction);
  if (!value) throw new Error(`Missing ${name} in backend/.env and backend/.env.production`);
  return value;
}

function getValue(name: string, preferProduction = false): string {
  return preferProduction
    ? productionEnv[name] || process.env[name] || ""
    : process.env[name] || productionEnv[name] || "";
}

const requiredRuntimeSecrets = [
  "JWT_SECRET",
  "WALLET_ENCRYPTION_KEY",
  "GENLAYER_OPERATOR_PRIVATE_KEY",
] as const;
for (const key of requiredChainSecrets) required(key);
if (!chainOnly) for (const key of requiredRuntimeSecrets) required(key, true);

const optionalRuntimeSecrets = [
  "REDIS_URL",
  "ADMIN_WALLETS",
  "ADMIN_EMAILS",
  "BREVO_API_KEY",
  "BREVO_SENDER_EMAIL",
  "BREVO_SENDER_NAME",
  "JWT_EXPIRES_IN",
  "FRONTEND_URL",
  "GENLAYER_RPC_URL",
] as const;

// DATABASE_URL is intentionally excluded. Production databases are attached
// with `fly postgres attach`, which creates a least-privilege role and manages
// the connection secret without exposing or accidentally overwriting it.

const values = [
  "GENLAYER_CONTRACT_ADDRESS=0x5BDD6676c2f3cc2e04356A61b6Fc9Cd621f1d023",
  `MEME_OLYMPICS_ESCROW_ADDRESS=${escrowAddress}`,
  `PUBLIC_URL=https://${appName}.fly.dev`,
  ...requiredChainSecrets.map((key) => `${key}=${required(key)}`),
  ...(chainOnly
    ? []
    : [
        ...requiredRuntimeSecrets.map((key) => `${key}=${required(key, true)}`),
        ...optionalRuntimeSecrets
          .filter((key) => getValue(key, true))
          .map((key) => `${key}=${getValue(key, true)}`),
      ]),
].join("\n");

const result = spawnSync(
  "fly",
  ["secrets", "import", "--app", appName],
  { input: `${values}\n`, encoding: "utf8", stdio: ["pipe", "inherit", "inherit"] }
);
if (result.error || result.status !== 0) {
  throw new Error("Fly secret import failed; authenticate with `fly auth login` and retry.");
}

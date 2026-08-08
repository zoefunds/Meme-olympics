import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const config = {
  port: parseInt(process.env.PORT || "8080", 10),
  nodeEnv: process.env.NODE_ENV || "development",
  databaseUrl: required("DATABASE_URL"),
  redisUrl: process.env.REDIS_URL || "",
  jwtSecret: required("JWT_SECRET"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
  // 32-byte hex key for AES-256-GCM wallet encryption
  walletEncryptionKey: required("WALLET_ENCRYPTION_KEY"),
  frontendUrl: process.env.FRONTEND_URL || "http://localhost:3000",
  // Canonical, stable host used to build absolute image URLs (e.g.
  // https://meme-olympics-api.fly.dev). Must NOT be derived from
  // req.protocol/req.get("host") at request time — behind Fly's proxy that
  // can report the wrong scheme/host, producing a URL that later 404s and
  // shows as a "missing image" on judged results.
  publicUrl: (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || "8080"}`).replace(
    /\/+$/,
    ""
  ),
  genlayer: {
    rpcUrl: process.env.GENLAYER_RPC_URL || "https://studio.genlayer.com/api",
    contractAddress: process.env.GENLAYER_CONTRACT_ADDRESS || "",
    // Operator account used for admin txs (create/finalize competitions)
    operatorPrivateKey: process.env.GENLAYER_OPERATOR_PRIVATE_KEY || "",
  },
  // Payment layer: GenLayer only judges; real USDC prize money lives in
  // MemeOlympicsEscrow on Base Sepolia. See backend/src/services/baseSepolia.ts.
  baseSepolia: {
    rpcUrl: process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
    usdcAddress:
      process.env.BASE_SEPOLIA_USDC_ADDRESS ||
      "0x036CbD53842c5426634e7929541eC2318f3dCF7e", // Circle's official Base Sepolia USDC
    escrowAddress: process.env.MEME_OLYMPICS_ESCROW_ADDRESS || "",
    // Backend-controlled wallet authorized as the escrow's relayer. Never
    // hardcode this — set it in backend/.env (gitignored) or your deploy
    // platform's secret store, never in source or chat.
    relayerPrivateKey: process.env.BASE_SEPOLIA_RELAYER_PRIVATE_KEY || "",
  },
  // Wallets auto-promoted to admin on their first wallet-login. Identity is
  // wallet-only now — there's no email to gate this on anymore.
  adminWallets: (process.env.ADMIN_WALLETS || "")
    .split(",")
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean),
};

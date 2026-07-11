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
  brevo: {
    apiKey: process.env.BREVO_API_KEY || "",
    senderEmail: process.env.BREVO_SENDER_EMAIL || "",
    senderName: process.env.BREVO_SENDER_NAME || "Meme Olympics",
  },
  genlayer: {
    rpcUrl: process.env.GENLAYER_RPC_URL || "https://studio.genlayer.com/api",
    contractAddress: process.env.GENLAYER_CONTRACT_ADDRESS || "",
    // Operator account used for admin txs (create/finalize competitions)
    operatorPrivateKey: process.env.GENLAYER_OPERATOR_PRIVATE_KEY || "",
  },
  adminEmails: (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
};

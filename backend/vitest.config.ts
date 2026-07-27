import { defineConfig } from "vitest/config";

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/test";
process.env.JWT_SECRET ||= "test-secret";
process.env.WALLET_ENCRYPTION_KEY ||= "0".repeat(64);

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});

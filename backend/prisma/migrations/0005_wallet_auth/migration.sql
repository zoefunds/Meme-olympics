-- Wallet-connect auth: users are identified by their real connected wallet
-- (authAddress) and sign in with a nonce signature, not a password.
-- walletAddress remains the separate custodial GenLayer-only signer.

-- Add authAddress nullable first so we can backfill existing rows.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "authAddress" TEXT;

-- Backfill: pre-migration accounts had no separate real wallet on record,
-- so their custodial wallet becomes their authAddress too (best available
-- fallback — they can't be silently logged out of an address they never
-- had, and can still connect a different wallet later since this column
-- has no on-chain meaning of its own, purely an app-level identity claim).
UPDATE "User" SET "authAddress" = "walletAddress" WHERE "authAddress" IS NULL;

ALTER TABLE "User" ALTER COLUMN "authAddress" SET NOT NULL;
DO $$ BEGIN
  ALTER TABLE "User" ADD CONSTRAINT "User_authAddress_key" UNIQUE ("authAddress");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Password auth is now optional/legacy.
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;
ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "User" ALTER COLUMN "username" DROP NOT NULL;

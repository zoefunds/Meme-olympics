-- The custodial GenLayer signer is gone: writes are now signed directly by
-- the connected wallet (genlayer-js supports signing via an injected
-- provider when given just an address, not only a raw local key). There is
-- no longer any private key for this backend to hold.

ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_walletAddress_key";
ALTER TABLE "User" DROP COLUMN IF EXISTS "walletAddress";
ALTER TABLE "User" DROP COLUMN IF EXISTS "encryptedPrivateKey";

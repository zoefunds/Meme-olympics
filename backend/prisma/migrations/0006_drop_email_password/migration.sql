-- Remove email/password entirely: identity is wallet-only now (authAddress
-- + SIWE signature login). Nothing in the app reads these anymore.

ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_email_key";
DROP INDEX IF EXISTS "User_email_idx";
ALTER TABLE "User" DROP COLUMN IF EXISTS "email";
ALTER TABLE "User" DROP COLUMN IF EXISTS "passwordHash";
ALTER TABLE "User" DROP COLUMN IF EXISTS "emailVerified";

DROP TABLE IF EXISTS "PasswordResetToken";
DROP TABLE IF EXISTS "NotificationLog";

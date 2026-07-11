/**
 * Custodial wallet key encryption — AES-256-GCM under a server master key.
 * Ciphertext format: hex(iv):hex(authTag):hex(ciphertext)
 *
 * The wallet is created at registration, stored encrypted in Postgres, and
 * therefore survives device changes, browser resets and reinstalls. Export
 * requires a fresh password check (see auth routes).
 */
import crypto from "crypto";
import { config } from "./config";

function masterKey(): Buffer {
  const key = Buffer.from(config.walletEncryptionKey, "hex");
  if (key.length !== 32) {
    throw new Error("WALLET_ENCRYPTION_KEY must be 32 bytes of hex (64 chars)");
  }
  return key;
}

export function encryptPrivateKey(privateKey: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", masterKey(), iv);
  const enc = Buffer.concat([cipher.update(privateKey, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

export function decryptPrivateKey(ciphertext: string): string {
  const [ivHex, tagHex, dataHex] = ciphertext.split(":");
  if (!ivHex || !tagHex || !dataHex) throw new Error("Malformed wallet ciphertext");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    masterKey(),
    Buffer.from(ivHex, "hex")
  );
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]);
  return dec.toString("utf8");
}

/** Generate missing local runtime secrets without printing their values. */
import dotenv from "dotenv";
import { randomBytes } from "node:crypto";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(process.cwd(), ".env");
dotenv.config({ path: envPath });

function setEnv(name: string, value: string) {
  let content = readFileSync(envPath, "utf8");
  const line = `${name}=${value}`;
  const pattern = new RegExp(`^${name}=.*$`, "m");
  content = pattern.test(content)
    ? content.replace(pattern, line)
    : `${content.replace(/\s*$/, "")}\n${line}\n`;
  writeFileSync(envPath, content, { mode: 0o600 });
  chmodSync(envPath, 0o600);
  process.env[name] = value;
  console.log(`Generated missing ${name}`);
}

if (!process.env.WALLET_ENCRYPTION_KEY) {
  setEnv("WALLET_ENCRYPTION_KEY", randomBytes(32).toString("hex"));
}
if (!process.env.JWT_SECRET) {
  setEnv("JWT_SECRET", randomBytes(48).toString("hex"));
}

console.log("Required generated runtime secrets are present.");

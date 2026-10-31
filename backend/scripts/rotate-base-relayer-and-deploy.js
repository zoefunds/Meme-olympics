#!/usr/bin/env node
/**
 * Rotates the Base Sepolia relayer and deploys a replacement escrow.
 *
 * The previous key is used once to fund the fresh wallet with test ETH. The
 * fresh key is written to the gitignored backend/.env before any transaction
 * is sent, so an interrupted deployment remains recoverable. Private keys are
 * never printed or passed as command-line arguments.
 */
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const { ethers } = require("ethers");
const solc = require("solc");

const envPath = path.resolve(__dirname, "../.env");
dotenv.config({ path: envPath });

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in backend/.env`);
  return value;
}

function setEnv(values) {
  let content = fs.readFileSync(envPath, "utf8");
  for (const [name, value] of Object.entries(values)) {
    const line = `${name}=${value}`;
    const pattern = new RegExp(`^${name}=.*$`, "m");
    content = pattern.test(content)
      ? content.replace(pattern, line)
      : `${content.replace(/\s*$/, "")}\n${line}\n`;
  }
  fs.writeFileSync(envPath, content, { mode: 0o600 });
  fs.chmodSync(envPath, 0o600);
}

function compile() {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../../contracts/base/MemeOlympicsEscrow.sol"),
    "utf8"
  );
  const input = {
    language: "Solidity",
    sources: { "MemeOlympicsEscrow.sol": { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors || []).filter((entry) => entry.severity === "error");
  if (errors.length) throw new Error(errors.map((entry) => entry.formattedMessage).join("\n"));
  return output.contracts["MemeOlympicsEscrow.sol"].MemeOlympicsEscrow;
}

async function main() {
  const provider = new ethers.JsonRpcProvider(required("BASE_SEPOLIA_RPC_URL"));
  const previous = new ethers.Wallet(required("BASE_SEPOLIA_RELAYER_PRIVATE_KEY"), provider);
  const fresh = ethers.Wallet.createRandom().connect(provider);

  setEnv({ BASE_SEPOLIA_RELAYER_PRIVATE_KEY: fresh.privateKey });
  console.log(`Fresh relayer created: ${fresh.address}`);

  const funding = await previous.sendTransaction({
    to: fresh.address,
    value: ethers.parseEther("0.025"),
  });
  console.log(`Relayer funding transaction: ${funding.hash}`);
  await funding.wait();

  const artifact = compile();
  const factory = new ethers.ContractFactory(
    artifact.abi,
    artifact.evm.bytecode.object,
    fresh
  );
  const escrow = await factory.deploy(
    required("BASE_SEPOLIA_USDC_ADDRESS"),
    fresh.address
  );
  const deployment = escrow.deploymentTransaction();
  console.log(`Escrow deployment transaction: ${deployment.hash}`);
  await escrow.waitForDeployment();
  const escrowAddress = await escrow.getAddress();
  setEnv({ MEME_OLYMPICS_ESCROW_ADDRESS: escrowAddress });

  const owner = await escrow.owner();
  const relayer = await escrow.relayer();
  const usdc = await escrow.usdc();
  if (owner !== fresh.address || relayer !== fresh.address) {
    throw new Error("Replacement escrow ownership/relayer verification failed");
  }
  console.log(`Replacement escrow: ${escrowAddress}`);
  console.log(`Owner/relayer verified: ${owner}`);
  console.log(`USDC verified: ${usdc}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

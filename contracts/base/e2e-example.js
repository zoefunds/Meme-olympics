#!/usr/bin/env node
/*
 * Base Sepolia end-to-end settlement demonstration. See README.md for the
 * required testnet-only environment variables. This intentionally never logs
 * private keys.
 */
const { ethers } = require("ethers");

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function amountUnits(value) {
  return ethers.parseUnits(required(value), 6);
}

async function main() {
  const rpc = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
  const escrowAddress = required("MEME_OLYMPICS_ESCROW_ADDRESS");
  const usdcAddress = process.env.BASE_SEPOLIA_USDC_ADDRESS || "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
  const competitionId = required("COMPETITION_ID");
  const unlockAt = BigInt(required("CHALLENGE_ENDS_AT_UNIX"));
  const amount = amountUnits("AMOUNT_USDC");
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (unlockAt >= now) {
    throw new Error(
      "CHALLENGE_ENDS_AT_UNIX must be an already-passed GenLayer challenge deadline"
    );
  }
  const provider = new ethers.JsonRpcProvider(rpc);
  const host = new ethers.Wallet(required("HOST_PRIVATE_KEY"), provider);
  const relayer = new ethers.Wallet(required("RELAYER_PRIVATE_KEY"), provider);
  const winner = new ethers.Wallet(required("WINNER_PRIVATE_KEY"), provider);
  // Keep ABI deliberately small and local to make this script portable.
  const escrow = [
    "function fundCompetition(bytes32,uint256)",
    "function setWinners(bytes32,address[],uint256[],uint256)",
    "function claim(bytes32)",
    "function getPool(bytes32) view returns(uint256,uint256,bool,uint256)",
    "function getClaimable(bytes32,address) view returns(uint256)",
  ];
  const erc20 = ["function approve(address,uint256) returns(bool)", "function balanceOf(address) view returns(uint256)"];
  const key = ethers.id(competitionId);
  const usdc = new ethers.Contract(usdcAddress, erc20, host);
  const hostEscrow = new ethers.Contract(escrowAddress, escrow, host);

  const approve = await usdc.approve(escrowAddress, amount);
  await approve.wait();
  console.log("approved:", approve.hash);
  const deposit = await hostEscrow.fundCompetition(key, amount);
  await deposit.wait();
  console.log("deposited:", deposit.hash);

  const relayerEscrow = hostEscrow.connect(relayer);
  const allocation = await relayerEscrow.setWinners(key, [winner.address], [amount], unlockAt);
  await allocation.wait();
  console.log("allocated:", allocation.hash);
  const pool = await hostEscrow.getPool(key);
  const claimable = await hostEscrow.getClaimable(key, winner.address);
  if (pool[1] !== amount || claimable !== amount || pool[3] !== unlockAt) {
    throw new Error("Allocation verification failed");
  }

  const winnerBalanceBefore = await usdc.balanceOf(winner.address);
  const winnerEscrow = hostEscrow.connect(winner);
  const claim = await winnerEscrow.claim(key);
  await claim.wait();
  const winnerBalanceAfter = await usdc.balanceOf(winner.address);
  const remainingClaimable = await hostEscrow.getClaimable(key, winner.address);
  if (winnerBalanceAfter - winnerBalanceBefore !== amount || remainingClaimable !== 0n) {
    throw new Error("Claim verification failed: winner balance/claimable state mismatch");
  }
  console.log("claimed:", claim.hash);
  console.log("verified winner USDC increase:", amount.toString());
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

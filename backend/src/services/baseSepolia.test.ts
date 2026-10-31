import { describe, expect, it, vi } from "vitest";
import { ethers } from "ethers";
import { MEME_OLYMPICS_ESCROW_ABI } from "../lib/escrowAbi";
import { reconcileExistingAllocation } from "./baseSepolia";

describe("reconcileExistingAllocation", () => {
  it("accepts an exact allocation after the winner has already claimed", async () => {
    const iface = new ethers.Interface(MEME_OLYMPICS_ESCROW_ABI);
    const key = ethers.id("claimed-before-marker");
    const winner = "0x00000000000000000000000000000000000000B0";
    const amount = 1_000_000n;
    const deadline = 1_800_000_000n;
    const txHash = `0x${"12".repeat(32)}`;
    const data = iface.encodeFunctionData("setWinners", [
      key,
      [winner],
      [amount],
      deadline,
    ]);
    const contract = {
      interface: iface,
      runner: {
        provider: {
          getTransaction: vi.fn(async () => ({ data, value: 0n })),
        },
      },
      filters: {
        WinnersSet: (competitionId: string) => ({ event: "WinnersSet", competitionId }),
        Claimed: (competitionId: string, address: string) => ({
          event: "Claimed", competitionId, address,
        }),
      },
      queryFilter: vi.fn(async (filter: { event: string }) =>
        filter.event === "WinnersSet"
          ? [{ transactionHash: txHash }]
          : [{ args: { amount } }]
      ),
      getClaimable: vi.fn(async () => 0n),
    } as unknown as ethers.Contract;

    await expect(
      reconcileExistingAllocation(
        contract,
        key,
        [winner],
        [amount],
        deadline,
        amount,
        deadline
      )
    ).resolves.toBe(txHash);
  });

  it("rejects claim history that cannot account for the original award", async () => {
    const iface = new ethers.Interface(MEME_OLYMPICS_ESCROW_ABI);
    const key = ethers.id("bad-claim-history");
    const winner = "0x00000000000000000000000000000000000000B0";
    const amount = 1_000_000n;
    const deadline = 1_800_000_000n;
    const data = iface.encodeFunctionData("setWinners", [key, [winner], [amount], deadline]);
    const contract = {
      interface: iface,
      runner: { provider: { getTransaction: vi.fn(async () => ({ data, value: 0n })) } },
      filters: {
        WinnersSet: () => ({ event: "WinnersSet" }),
        Claimed: () => ({ event: "Claimed" }),
      },
      queryFilter: vi.fn(async (filter: { event: string }) =>
        filter.event === "WinnersSet"
          ? [{ transactionHash: `0x${"34".repeat(32)}` }]
          : [{ args: { amount: 400_000n } }]
      ),
      getClaimable: vi.fn(async () => 0n),
    } as unknown as ethers.Contract;

    await expect(
      reconcileExistingAllocation(
        contract, key, [winner], [amount], deadline, amount, deadline
      )
    ).rejects.toThrow("balance plus claims");
  });
});

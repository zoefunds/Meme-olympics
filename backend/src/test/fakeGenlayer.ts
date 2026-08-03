import { vi } from "vitest";

/**
 * Configurable fake for the genlayer service module. Each write call is
 * recorded so tests can assert exactly which on-chain transactions were
 * (or weren't) sent — the core of what "authoritative on-chain" means.
 */
export function createFakeGenlayer() {
  const calls: { fn: string; args: any[] }[] = [];
  const record =
    (fn: string) =>
    (...args: any[]) => {
      calls.push({ fn, args });
      const impl = impls[fn];
      if (impl) return impl(...args);
      return Promise.resolve(`0xhash-${fn}-${calls.length}`);
    };

  const impls: Record<string, (...args: any[]) => any> = {};

  const mod = {
    isChainConfigured: vi.fn(() => true),
    createCompetitionOnChain: vi.fn(record("createCompetitionOnChain")),
    markPrizesRelayedOnChain: vi.fn(record("markPrizesRelayedOnChain")),
    openCompetitionOnChain: vi.fn(record("openCompetitionOnChain")),
    closeSubmissionsOnChain: vi.fn(record("closeSubmissionsOnChain")),
    finalizeCompetitionOnChain: vi.fn(record("finalizeCompetitionOnChain")),
    evaluateSubmissionOnChain: vi.fn(record("evaluateSubmissionOnChain")),
    resolveDisputeOnChain: vi.fn(record("resolveDisputeOnChain")),
    getOnchainSubmission: vi.fn(record("getOnchainSubmission")),
    getOnchainCompetition: vi.fn(record("getOnchainCompetition")),
    getOnchainLeaderboard: vi.fn(record("getOnchainLeaderboard")),
    getDeclaredReward: vi.fn(record("getDeclaredReward")),
    getContractInfo: vi.fn(record("getContractInfo")),
    readContract: vi.fn(record("readContract")),
    readUntilFound: vi.fn(record("readUntilFound")),
    readSettled: vi.fn(async (fn: string, args: any[], isSettled: (v: any) => boolean) => {
      const v = await mod.readContract(fn, args);
      return v;
    }),
    __calls: calls,
    __setImpl(fn: string, impl: (...args: any[]) => any) {
      impls[fn] = impl;
    },
  };
  return mod;
}

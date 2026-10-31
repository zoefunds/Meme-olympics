import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakePrisma, type FakePrisma } from "../test/fakePrisma";
import { createFakeGenlayer } from "../test/fakeGenlayer";

let fakePrisma: FakePrisma;
let fakeGl: ReturnType<typeof createFakeGenlayer>;
let fakeEscrow: {
  isEscrowConfigured: ReturnType<typeof vi.fn>;
  relayWinnersToEscrow: ReturnType<typeof vi.fn>;
};

vi.mock("../lib/prisma", () => ({
  get prisma() {
    return fakePrisma;
  },
}));
vi.mock("../services/genlayer", () => ({
  get isChainConfigured() {
    return fakeGl.isChainConfigured;
  },
  get createCompetitionOnChain() {
    return fakeGl.createCompetitionOnChain;
  },
  get openCompetitionOnChain() {
    return fakeGl.openCompetitionOnChain;
  },
  get closeSubmissionsOnChain() {
    return fakeGl.closeSubmissionsOnChain;
  },
  get finalizeCompetitionOnChain() {
    return fakeGl.finalizeCompetitionOnChain;
  },
  get evaluateSubmissionOnChain() {
    return fakeGl.evaluateSubmissionOnChain;
  },
  get disqualifyUnjudgeableSubmissionOnChain() {
    return fakeGl.disqualifyUnjudgeableSubmissionOnChain;
  },
  get recordUnjudgeableAttemptOnChain() {
    return fakeGl.recordUnjudgeableAttemptOnChain;
  },
  get resolveDisputeOnChain() {
    return fakeGl.resolveDisputeOnChain;
  },
  get getOnchainSubmission() {
    return fakeGl.getOnchainSubmission;
  },
  get getOnchainCompetition() {
    return fakeGl.getOnchainCompetition;
  },
  get canRelayPrizesOnChain() {
    return fakeGl.canRelayPrizesOnChain;
  },
  get markPrizesRelayedOnChain() {
    return fakeGl.markPrizesRelayedOnChain;
  },
  get readSettled() {
    return fakeGl.readSettled;
  },
  get readContract() {
    return fakeGl.readContract;
  },
}));
vi.mock("../services/baseSepolia", () => ({
  get isEscrowConfigured() {
    return fakeEscrow.isEscrowConfigured;
  },
  get relayWinnersToEscrow() {
    return fakeEscrow.relayWinnersToEscrow;
  },
}));
vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Imported after mocks are registered so the module under test picks up the fakes.
const weekly = await import("./weekly");

function makeCompetition(overrides: Partial<Record<string, any>> = {}) {
  return {
    id: "week-2026-30",
    title: "Meme Olympics Week 30",
    theme: "test",
    status: "open",
    startsAt: new Date(Date.now() - 3600_000),
    endsAt: new Date(Date.now() + 3600_000),
    onchainCreated: true,
    onchainFinalized: false,
    winnersJson: "[]",
    createdByUserId: null,
    prizeAtto: "0",
    ...overrides,
  };
}

beforeEach(() => {
  fakePrisma = createFakePrisma();
  fakeGl = createFakeGenlayer();
  fakeEscrow = {
    isEscrowConfigured: vi.fn(() => true),
    relayWinnersToEscrow: vi.fn(async () => ({ txHash: "0xbase", reconciled: false })),
  };
});

afterEach(() => {
  vi.useRealTimers();
});

describe("runDeadlineClose / closeCompetition", () => {
  it("does not close (or score) a competition before its deadline", async () => {
    await fakePrisma.competition.create({
      data: makeCompetition({ endsAt: new Date(Date.now() + 3600_000) }),
    });

    const result = await weekly.runDeadlineClose();

    expect(result.closed).toEqual([]);
    const comp = await fakePrisma.competition.findUnique({ where: { id: "week-2026-30" } });
    expect(comp!.status).toBe("open");
    expect(fakeGl.closeSubmissionsOnChain).not.toHaveBeenCalled();
  });

  it("closes on-chain and flips to judging once the deadline has passed", async () => {
    await fakePrisma.competition.create({
      data: makeCompetition({ endsAt: new Date(Date.now() - 1000) }),
    });

    const result = await weekly.runDeadlineClose();

    expect(result.closed).toEqual(["week-2026-30"]);
    expect(fakeGl.closeSubmissionsOnChain).toHaveBeenCalledWith("week-2026-30");
    const comp = await fakePrisma.competition.findUnique({ where: { id: "week-2026-30" } });
    expect(comp!.status).toBe("judging");
  });

  it("refuses to close a competition that never confirmed on-chain (no orphaned close)", async () => {
    await fakePrisma.competition.create({
      data: makeCompetition({ endsAt: new Date(Date.now() - 1000), onchainCreated: false }),
    });

    await weekly.runDeadlineClose();

    expect(fakeGl.closeSubmissionsOnChain).not.toHaveBeenCalled();
    const comp = await fakePrisma.competition.findUnique({ where: { id: "week-2026-30" } });
    // Left open (not silently moved to judging) so it has a path to
    // reconciliation instead of being stuck unable to ever finalize.
    expect(comp!.status).toBe("open");
  });

  it("is idempotent — closing an already-judging competition is a no-op", async () => {
    await fakePrisma.competition.create({
      data: makeCompetition({ status: "judging", endsAt: new Date(Date.now() - 1000) }),
    });

    await weekly.runDeadlineClose();

    expect(fakeGl.closeSubmissionsOnChain).not.toHaveBeenCalled();
  });
});

describe("retryOnchainCreationSweep", () => {
  it("retries creation for an open competition stuck off-chain and arms its close timer on success", async () => {
    await fakePrisma.competition.create({
      data: makeCompetition({ onchainCreated: false, endsAt: new Date(Date.now() + 3600_000) }),
    });

    const result = await weekly.retryOnchainCreationSweep();

    expect(result.retried).toEqual(["week-2026-30"]);
    expect(fakeGl.createCompetitionOnChain).toHaveBeenCalled();
    const comp = await fakePrisma.competition.findUnique({ where: { id: "week-2026-30" } });
    expect(comp!.onchainCreated).toBe(true);
  });

  it("leaves the row off-chain and retries again next tick if creation keeps failing", async () => {
    fakeGl.createCompetitionOnChain.mockRejectedValue(new Error("RPC unreachable"));
    await fakePrisma.competition.create({
      data: makeCompetition({ onchainCreated: false }),
    });

    const result = await weekly.retryOnchainCreationSweep();

    expect(result.retried).toEqual([]);
    const comp = await fakePrisma.competition.findUnique({ where: { id: "week-2026-30" } });
    expect(comp!.onchainCreated).toBe(false);
  });
});

describe("runJudgingSweep", () => {
  it("never evaluates a submission whose competition is still open (no early scoring)", async () => {
    await fakePrisma.competition.create({ data: makeCompetition({ status: "open" }) });
    await fakePrisma.user.create({ data: { id: "u1", email: "a@a.com", encryptedPrivateKey: "k" } });
    await fakePrisma.submission.create({
      data: {
        id: "s1",
        competitionId: "week-2026-30",
        userId: "u1",
        status: "onchain",
        title: "t",
      },
    });

    const result = await weekly.runJudgingSweep();

    expect(result.evaluated).toBe(0);
    expect(fakeGl.evaluateSubmissionOnChain).not.toHaveBeenCalled();
  });

  it("evaluates a submission once its competition has closed, and syncs the result", async () => {
    await fakePrisma.competition.create({
      data: makeCompetition({ status: "judging", endsAt: new Date(Date.now() - 1000) }),
    });
    await fakePrisma.user.create({ data: { id: "u1", email: "a@a.com", encryptedPrivateKey: "k" } });
    await fakePrisma.submission.create({
      data: {
        id: "s1",
        competitionId: "week-2026-30",
        userId: "u1",
        status: "onchain",
        title: "t",
      },
    });
    let reads = 0;
    fakeGl.__setImpl("getOnchainSubmission", () => {
      reads++;
      if (reads === 1) return { status: "pending" };
      return {
        status: "evaluated",
        total_score: 87,
        criteria: { humor: 9 },
        plagiarism_verdict: "clear",
        plagiarism_confidence: 5,
        evaluation_summary: "solid",
      };
    });

    const result = await weekly.runJudgingSweep();

    expect(result.evaluated).toBe(1);
    expect(fakeGl.evaluateSubmissionOnChain).toHaveBeenCalledWith("s1");
    const sub = await fakePrisma.submission.findUnique({ where: { id: "s1" } });
    expect(sub!.status).toBe("evaluated");
    expect(sub!.totalScore).toBe(87);
  });

  it("marks a submission failed after 30 minutes if it never registered on-chain, instead of retrying forever", async () => {
    await fakePrisma.competition.create({
      data: makeCompetition({ status: "judging", endsAt: new Date(Date.now() - 1000) }),
    });
    await fakePrisma.user.create({ data: { id: "u1", email: "a@a.com", encryptedPrivateKey: "k" } });
    await fakePrisma.submission.create({
      data: {
        id: "s1",
        competitionId: "week-2026-30",
        userId: "u1",
        status: "pending",
        title: "t",
        createdAt: new Date(Date.now() - 31 * 60 * 1000),
      },
    });
    fakeGl.getOnchainSubmission.mockRejectedValue(new Error("Submission not found"));

    await weekly.runJudgingSweep();

    const sub = await fakePrisma.submission.findUnique({ where: { id: "s1" } });
    expect(sub!.status).toBe("failed");
  });

  it("records repeated INVALID_IMAGE terminally on-chain and then permits finalization", async () => {
    const failedEvaluationTx = `0x${"ab".repeat(32)}`;
    await fakePrisma.competition.create({
      data: makeCompetition({ status: "judging", endsAt: new Date(Date.now() - 1000) }),
    });
    await fakePrisma.user.create({ data: { id: "u1", email: "a@a.com", encryptedPrivateKey: "k" } });
    await fakePrisma.submission.create({
      data: {
        id: "s1", competitionId: "week-2026-30", userId: "u1", status: "onchain",
        title: "t", invalidImageAttempts: 2,
      },
    });
    fakeGl.__setImpl("getOnchainSubmission", () => ({ status: "pending" }));
    fakeGl.evaluateSubmissionOnChain.mockRejectedValue(
      new Error(`Transaction executed with ERROR: [LLM_ERROR] INVALID_IMAGE (${failedEvaluationTx})`)
    );
    let submissionReads = 0;
    fakeGl.__setImpl("readContract", (fn: string) => {
      if (fn !== "get_submission") return { status: "finalized", winners: [] };
      submissionReads++;
      return submissionReads === 1
        ? {
            status: "pending",
            unjudgeable_attempt_count: 3,
            unjudgeable_attempt_tx_hashes: [failedEvaluationTx],
          }
        : { status: "disqualified", evaluation_summary: "Repeated INVALID_IMAGE" };
    });

    await weekly.runJudgingSweep();
    expect(fakeGl.recordUnjudgeableAttemptOnChain).toHaveBeenCalledWith(
      "s1", failedEvaluationTx
    );
    expect(fakeGl.disqualifyUnjudgeableSubmissionOnChain).toHaveBeenCalledWith(
      "s1", expect.stringContaining("INVALID_IMAGE")
    );
    expect((await fakePrisma.submission.findUnique({ where: { id: "s1" } }))!.status)
      .toBe("disqualified");

    fakeGl.__setImpl("getOnchainCompetition", () => ({ status: "judging" }));
    const result = await weekly.runFinalization();
    expect(result.finalized).toEqual(["week-2026-30"]);
  });

  it("refuses terminal recovery when INVALID_IMAGE has no failed transaction hash", async () => {
    await fakePrisma.competition.create({
      data: makeCompetition({ status: "judging", endsAt: new Date(Date.now() - 1000) }),
    });
    await fakePrisma.submission.create({
      data: {
        id: "s-no-proof", competitionId: "week-2026-30", userId: "u1",
        status: "onchain", title: "t", invalidImageAttempts: 2,
      },
    });
    fakeGl.__setImpl("getOnchainSubmission", () => ({ status: "pending" }));
    fakeGl.evaluateSubmissionOnChain.mockRejectedValue(new Error("INVALID_IMAGE"));

    await weekly.runJudgingSweep();

    expect(fakeGl.recordUnjudgeableAttemptOnChain).not.toHaveBeenCalled();
    expect(fakeGl.disqualifyUnjudgeableSubmissionOnChain).not.toHaveBeenCalled();
    expect((await fakePrisma.submission.findUnique({ where: { id: "s-no-proof" } }))!.status)
      .toBe("onchain");
  });
});

describe("runFinalization (payout)", () => {
  it("does not finalize while any submission is still unprocessed (no early/partial payout)", async () => {
    await fakePrisma.competition.create({
      data: makeCompetition({ status: "judging", endsAt: new Date(Date.now() - 1000) }),
    });
    await fakePrisma.user.create({ data: { id: "u1", email: "a@a.com", encryptedPrivateKey: "k" } });
    await fakePrisma.submission.create({
      data: { id: "s1", competitionId: "week-2026-30", userId: "u1", status: "onchain", title: "t" },
    });

    const result = await weekly.runFinalization();

    expect(result.finalized).toEqual([]);
    expect(fakeGl.finalizeCompetitionOnChain).not.toHaveBeenCalled();
  });

  it("finalizes and records winners only after the on-chain finalize is confirmed", async () => {
    await fakePrisma.competition.create({
      data: makeCompetition({ status: "judging", endsAt: new Date(Date.now() - 1000) }),
    });
    await fakePrisma.user.create({ data: { id: "u1", email: "a@a.com", encryptedPrivateKey: "k" } });
    await fakePrisma.submission.create({
      data: { id: "s1", competitionId: "week-2026-30", userId: "u1", status: "evaluated", title: "t" },
    });
    fakeGl.__setImpl("getOnchainCompetition", () => ({ status: "judging" }));
    fakeGl.__setImpl("readContract", (fn: string) =>
      fn === "get_competition"
        ? {
            status: "finalized",
            winners: [{ submission_id: "s1", author: "0xabc", rank: 1, score: 90, reward_usdc: String(10n ** 6n) }],
          }
        : {}
    );

    const result = await weekly.runFinalization();

    expect(result.finalized).toEqual(["week-2026-30"]);
    expect(fakeGl.finalizeCompetitionOnChain).toHaveBeenCalledWith(
      "week-2026-30",
      expect.any(String)
    );
    const comp = await fakePrisma.competition.findUnique({ where: { id: "week-2026-30" } });
    expect(comp!.status).toBe("finalized");
    expect(comp!.onchainFinalized).toBe(true);
    const sub = await fakePrisma.submission.findUnique({ where: { id: "s1" } });
    expect(sub!.status).toBe("winner");
  });

  it("does not mark finalized (or pay out) locally if the on-chain finalize read never settles", async () => {
    await fakePrisma.competition.create({
      data: makeCompetition({ status: "judging", endsAt: new Date(Date.now() - 1000) }),
    });
    await fakePrisma.user.create({ data: { id: "u1", email: "a@a.com", encryptedPrivateKey: "k" } });
    await fakePrisma.submission.create({
      data: { id: "s1", competitionId: "week-2026-30", userId: "u1", status: "evaluated", title: "t" },
    });
    fakeGl.__setImpl("getOnchainCompetition", () => ({ status: "judging" }));
    // Read never reflects "finalized" — simulates a chain read that lags forever.
    fakeGl.__setImpl("readContract", () => ({ status: "judging", winners: [] }));

    const result = await weekly.runFinalization();

    expect(result.finalized).toEqual([]);
    const comp = await fakePrisma.competition.findUnique({ where: { id: "week-2026-30" } });
    expect(comp!.status).toBe("judging");
    const sub = await fakePrisma.submission.findUnique({ where: { id: "s1" } });
    expect(sub!.status).toBe("evaluated");
  });
});

describe("runPrizeRelaySweep", () => {
  it("settles the authoritative post-dispute winner instead of the cached finalist", async () => {
    const challengeEnded = Math.floor(Date.now() / 1000) - 60;
    await fakePrisma.competition.create({
      data: makeCompetition({
        status: "finalized", onchainFinalized: true,
        winnersJson: JSON.stringify([{ submission_id: "old", author: "0xold", rank: 1, score: 99, reward_usdc: "1000000" }]),
      }),
    });
    await fakePrisma.submission.create({
      data: { id: "old", competitionId: "week-2026-30", userId: "u1", status: "winner" },
    });
    await fakePrisma.submission.create({
      data: { id: "new", competitionId: "week-2026-30", userId: "u2", status: "evaluated" },
    });
    const authoritative = [
      { submission_id: "new", author: "0xnew", rank: 1, score: 94, reward_usdc: "1000000" },
    ];
    fakeGl.__setImpl("getOnchainCompetition", () => ({
      status: "finalized", winners: authoritative, relay_tx_hash: "", challenge_ends_at: String(challengeEnded),
    }));
    fakeGl.canRelayPrizesOnChain.mockResolvedValue(true);

    const result = await weekly.runPrizeRelaySweep();

    expect(result.relayed).toEqual(["week-2026-30"]);
    expect(fakeEscrow.relayWinnersToEscrow).toHaveBeenCalledWith(
      "week-2026-30", authoritative, BigInt(challengeEnded)
    );
    expect(fakeGl.markPrizesRelayedOnChain).toHaveBeenCalledWith("week-2026-30", "0xbase");
    expect((await fakePrisma.submission.findUnique({ where: { id: "old" } }))!.status)
      .toBe("disqualified");
    expect((await fakePrisma.submission.findUnique({ where: { id: "new" } }))!.status)
      .toBe("winner");
    const comp = await fakePrisma.competition.findUnique({ where: { id: "week-2026-30" } });
    expect(JSON.parse(comp!.winnersJson)).toEqual(authoritative);
  });
});

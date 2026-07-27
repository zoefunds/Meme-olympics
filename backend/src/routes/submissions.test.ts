import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakePrisma, type FakePrisma } from "../test/fakePrisma";
import { createFakeGenlayer } from "../test/fakeGenlayer";

let fakePrisma: FakePrisma;
let fakeGl: ReturnType<typeof createFakeGenlayer>;

vi.mock("../lib/prisma", () => ({
  get prisma() {
    return fakePrisma;
  },
}));
vi.mock("../services/genlayer", () => ({
  get isChainConfigured() {
    return fakeGl.isChainConfigured;
  },
  get submitMemeOnChain() {
    return fakeGl.submitMemeOnChain;
  },
}));
vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../lib/walletCrypto", () => ({
  decryptPrivateKey: () => "fake-private-key",
}));
vi.mock("../lib/redis", () => ({
  rateLimit: () => Promise.resolve(true),
  cacheGet: () => Promise.resolve(null),
  cacheSet: () => Promise.resolve(),
}));
vi.mock("../middleware/auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = "u1";
    next();
  },
}));

const { submissionsRouter } = await import("./submissions");

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/submissions", submissionsRouter);
  return app;
}

beforeEach(() => {
  fakePrisma = createFakePrisma();
  fakeGl = createFakeGenlayer();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/submissions", () => {
  async function seedOpenCompetition(overrides: Partial<Record<string, any>> = {}) {
    await fakePrisma.competition.create({
      data: {
        id: "week-1",
        title: "t",
        theme: "t",
        status: "open",
        startsAt: new Date(Date.now() - 1000),
        endsAt: new Date(Date.now() + 3600_000),
        onchainCreated: true,
        onchainFinalized: false,
        winnersJson: "[]",
        prizeAtto: "0",
        ...overrides,
      },
    });
    await fakePrisma.user.create({
      data: { id: "u1", email: "a@a.com", encryptedPrivateKey: "k", walletAddress: "0x1" },
    });
  }

  it("accepts a submission to a genuinely open, non-expired competition", async () => {
    await seedOpenCompetition();

    const res = await request(makeApp()).post("/api/submissions").send({
      competitionId: "week-1",
      title: "meme",
      imageUrl: "https://example.com/a.png",
    });

    expect(res.status).toBe(201);
    expect(res.body.submission.status).toBe("onchain");
    expect(fakeGl.submitMemeOnChain).toHaveBeenCalled();
  });

  it("rejects a submission once the deadline has passed, even if status row still says 'open'", async () => {
    // Simulates the narrow window before the close timer has fired.
    await seedOpenCompetition({ endsAt: new Date(Date.now() - 1000) });

    const res = await request(makeApp()).post("/api/submissions").send({
      competitionId: "week-1",
      title: "meme",
      imageUrl: "https://example.com/a.png",
    });

    expect(res.status).toBe(400);
    expect(fakeGl.submitMemeOnChain).not.toHaveBeenCalled();
    const count = await fakePrisma.submission.count({});
    expect(count).toBe(0);
  });

  it("rejects a submission to a competition that is closed (judging)", async () => {
    await seedOpenCompetition({ status: "judging", endsAt: new Date(Date.now() - 1000) });

    const res = await request(makeApp()).post("/api/submissions").send({
      competitionId: "week-1",
      title: "meme",
      imageUrl: "https://example.com/a.png",
    });

    expect(res.status).toBe(400);
    expect(fakeGl.submitMemeOnChain).not.toHaveBeenCalled();
  });

  it("keeps the row pending (for retry) rather than failing the request when the on-chain write errors", async () => {
    await seedOpenCompetition();
    fakeGl.submitMemeOnChain.mockRejectedValue(new Error("RPC down"));

    const res = await request(makeApp()).post("/api/submissions").send({
      competitionId: "week-1",
      title: "meme",
      imageUrl: "https://example.com/a.png",
    });

    expect(res.status).toBe(201);
    expect(res.body.submission.status).toBe("pending");
    const sub = await fakePrisma.submission.findFirst({});
    expect(sub!.status).toBe("pending");
  });
});

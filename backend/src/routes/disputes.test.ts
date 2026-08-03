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
  get readContract() {
    return fakeGl.readContract;
  },
  get readUntilFound() {
    return fakeGl.readUntilFound;
  },
}));
vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
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

const { disputesRouter } = await import("./disputes");

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/disputes", disputesRouter);
  return app;
}

beforeEach(async () => {
  fakePrisma = createFakePrisma();
  fakeGl = createFakeGenlayer();
  await fakePrisma.user.create({
    data: { id: "u1", authAddress: "0x1", walletAddress: "0x1" },
  });
  await fakePrisma.submission.create({
    data: {
      id: "s1",
      competitionId: "week-1",
      userId: "u1",
      status: "evaluated",
      title: "t",
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/disputes", () => {
  it("registers the dispute row — the on-chain open_dispute call is signed by the user's own wallet from the frontend", async () => {
    const res = await request(makeApp()).post("/api/disputes").send({
      submissionId: "s1",
      reason: "Score seems wrong for this entry",
      evidenceUrl: "https://example.com/evidence",
    });

    expect(res.status).toBe(201);
    const dispute = await fakePrisma.dispute.findUnique({ where: { id: res.body.dispute.id } });
    expect(dispute!.onchainOpened).toBeFalsy();
  });

  it("rejects a dispute against a submission that hasn't been evaluated yet", async () => {
    await fakePrisma.submission.update({ where: { id: "s1" }, data: { status: "pending" } });

    const res = await request(makeApp()).post("/api/disputes").send({
      submissionId: "s1",
      reason: "Score seems wrong for this entry",
      evidenceUrl: "https://example.com/evidence",
    });

    expect(res.status).toBe(400);
  });
});

describe("POST /api/disputes/:id/onchain-confirm", () => {
  it("marks onchainOpened once GenLayer confirms the dispute exists", async () => {
    const created = await request(makeApp()).post("/api/disputes").send({
      submissionId: "s1",
      reason: "Score seems wrong for this entry",
      evidenceUrl: "https://example.com/evidence",
    });
    const id = created.body.dispute.id;
    fakeGl.readUntilFound.mockResolvedValue({ status: "open" });

    const res = await request(makeApp()).post(`/api/disputes/${id}/onchain-confirm`);

    expect(res.status).toBe(200);
    const dispute = await fakePrisma.dispute.findUnique({ where: { id } });
    expect(dispute!.onchainOpened).toBe(true);
  });
});

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
  get createCompetitionOnChain() {
    return fakeGl.createCompetitionOnChain;
  },
  get openCompetitionOnChain() {
    return fakeGl.openCompetitionOnChain;
  },
  get getContractInfo() {
    return fakeGl.getContractInfo;
  },
  get resolveDisputeOnChain() {
    return fakeGl.resolveDisputeOnChain;
  },
  get readContract() {
    return fakeGl.readContract;
  },
}));
vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../jobs/weekly", () => ({
  runWeeklyRollover: vi.fn(),
  runJudgingSweep: vi.fn(),
  scheduleClose: vi.fn(),
}));
vi.mock("../middleware/auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = "admin1";
    req.userRole = "admin";
    next();
  },
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));

const { adminRouter } = await import("./admin");

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/admin", adminRouter);
  return app;
}

beforeEach(() => {
  fakePrisma = createFakePrisma();
  fakeGl = createFakeGenlayer();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/admin/competitions", () => {
  it("rolls back the row instead of leaving an orphaned arena when on-chain creation fails", async () => {
    fakeGl.createCompetitionOnChain.mockRejectedValue(new Error("RPC unreachable"));

    const res = await request(makeApp())
      .post("/api/admin/competitions")
      .send({
        id: "arena-x",
        title: "Arena X",
        startsAt: new Date().toISOString(),
        endsAt: new Date(Date.now() + 3600_000).toISOString(),
      });

    expect(res.status).toBe(502);
    const count = await fakePrisma.competition.count({});
    expect(count).toBe(0);
  });

  it("persists onchainCreated only once chain calls succeed", async () => {
    const res = await request(makeApp())
      .post("/api/admin/competitions")
      .send({
        id: "arena-y",
        title: "Arena Y",
        startsAt: new Date().toISOString(),
        endsAt: new Date(Date.now() + 3600_000).toISOString(),
      });

    expect(res.status).toBe(201);
    const comp = await fakePrisma.competition.findUnique({ where: { id: "arena-y" } });
    expect(comp!.onchainCreated).toBe(true);
  });
});

describe("POST /api/admin/resolve-dispute/:id", () => {
  it("syncs local dispute state from the confirmed on-chain resolution", async () => {
    await fakePrisma.dispute.create({
      data: {
        id: "d1",
        submissionId: "s1",
        userId: "u1",
        reason: "r",
        evidenceUrl: "https://e",
        status: "open",
      },
    });
    fakeGl.__setImpl("readContract", () => ({ status: "upheld", verdict_summary: "valid claim" }));

    const res = await request(makeApp()).post("/api/admin/resolve-dispute/d1").send({});

    expect(res.status).toBe(200);
    expect(res.body.dispute.status).toBe("upheld");
    const dispute = await fakePrisma.dispute.findUnique({ where: { id: "d1" } });
    expect(dispute!.verdict).toBe("valid claim");
    expect(dispute!.resolvedAt).toBeTruthy();
  });
});

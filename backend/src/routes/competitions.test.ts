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
  get getOnchainCompetition() {
    return fakeGl.getOnchainCompetition;
  },
  get readUntilFound() {
    return fakeGl.readUntilFound;
  },
  get openCompetitionOnChain() {
    return fakeGl.openCompetitionOnChain;
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
vi.mock("../jobs/weekly", () => ({
  scheduleClose: vi.fn(),
}));
vi.mock("../middleware/auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = "u1";
    next();
  },
}));

const { competitionsRouter } = await import("./competitions");

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/competitions", competitionsRouter);
  return app;
}

beforeEach(async () => {
  fakePrisma = createFakePrisma();
  fakeGl = createFakeGenlayer();
  await fakePrisma.user.create({
    data: { id: "u1", authAddress: "0x1", walletAddress: "0x1" },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/competitions (host-created arena)", () => {
  it("creates the row without any backend chain call — the host's wallet signs create+open from the frontend", async () => {
    const res = await request(makeApp()).post("/api/competitions").send({
      title: "My Arena",
      endsAt: new Date(Date.now() + 3600_000).toISOString(),
    });

    expect(res.status).toBe(201);
    const comp = await fakePrisma.competition.findUnique({ where: { id: res.body.competition.id } });
    expect(comp!.onchainCreated).toBeFalsy();
  });
});

describe("POST /api/competitions/:id/onchain-confirm", () => {
  it("marks onchainCreated once GenLayer confirms the competition is open", async () => {
    const created = await request(makeApp()).post("/api/competitions").send({
      title: "My Arena",
      endsAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    const id = created.body.competition.id;
    fakeGl.readUntilFound.mockResolvedValue({ status: "open" });

    const res = await request(makeApp()).post(`/api/competitions/${id}/onchain-confirm`);

    expect(res.status).toBe(200);
    const comp = await fakePrisma.competition.findUnique({ where: { id } });
    expect(comp!.onchainCreated).toBe(true);
  });

  it("refuses to confirm when GenLayer doesn't show the competition as open yet", async () => {
    const created = await request(makeApp()).post("/api/competitions").send({
      title: "Doomed Arena",
      endsAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    const id = created.body.competition.id;
    fakeGl.readUntilFound.mockResolvedValue(null);

    const res = await request(makeApp()).post(`/api/competitions/${id}/onchain-confirm`);

    expect(res.status).toBe(409);
    const comp = await fakePrisma.competition.findUnique({ where: { id } });
    expect(comp!.onchainCreated).toBeFalsy();
  });
});

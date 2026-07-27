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
  get createCompetitionAsUser() {
    return fakeGl.createCompetitionAsUser;
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
vi.mock("../lib/walletCrypto", () => ({
  decryptPrivateKey: () => "fake-private-key",
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
    data: { id: "u1", email: "a@a.com", encryptedPrivateKey: "k", walletAddress: "0x1" },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/competitions (host-created arena)", () => {
  it("creates and marks onchainCreated once the chain calls succeed", async () => {
    const res = await request(makeApp()).post("/api/competitions").send({
      title: "My Arena",
      endsAt: new Date(Date.now() + 3600_000).toISOString(),
    });

    expect(res.status).toBe(201);
    const comp = await fakePrisma.competition.findUnique({ where: { id: res.body.competition.id } });
    expect(comp!.onchainCreated).toBe(true);
  });

  it("rolls back (deletes) the row instead of leaving an orphan when on-chain creation fails", async () => {
    fakeGl.createCompetitionAsUser.mockRejectedValue(new Error("insufficient GEN balance"));

    const res = await request(makeApp()).post("/api/competitions").send({
      title: "Doomed Arena",
      endsAt: new Date(Date.now() + 3600_000).toISOString(),
    });

    expect(res.status).toBe(502);
    const count = await fakePrisma.competition.count({});
    expect(count).toBe(0);
  });
});

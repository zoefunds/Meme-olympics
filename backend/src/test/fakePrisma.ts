/**
 * Minimal in-memory stand-in for the Prisma client, covering only the
 * query shapes the lifecycle code (jobs/weekly.ts, routes) actually uses.
 * Not a Prisma reimplementation — just enough `where`/`data` handling to
 * exercise real route/job logic against real objects instead of asserting
 * on mock call arguments.
 */
type Row = Record<string, any>;

function matches(
  row: Row,
  where: Row = {},
  relations: Record<string, { table: () => Table; fk: string }> = {}
): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (relations[key]) {
      const related = relations[key].table().rows.find((r) => r.id === row[relations[key].fk]);
      return related ? matches(related, cond) : false;
    }
    if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      if ("in" in cond) return (cond.in as any[]).includes(row[key]);
      if ("lte" in cond) return row[key] <= cond.lte;
      if ("gte" in cond) return row[key] >= cond.gte;
      if ("gt" in cond) return row[key] > cond.gt;
    }
    return row[key] === cond;
  });
}

class Table {
  rows: Row[] = [];
  relations: Record<string, { table: () => Table; fk: string }> = {};

  constructor(private name: string) {}

  private attach(row: Row, include?: Row): Row {
    if (!row) return row;
    const out = { ...row };
    if (include) {
      for (const key of Object.keys(include)) {
        const rel = this.relations[key];
        if (!rel) continue;
        const related = rel.table().rows.find((r) => r.id === row[rel.fk]);
        out[key] = related ? { ...related } : null;
      }
    }
    return out;
  }

  async findUnique({ where, include }: { where: Row; include?: Row }) {
    const row = this.rows.find((r) => matches(r, where, this.relations));
    return row ? this.attach(row, include) : null;
  }

  async findFirst({ where, include }: { where?: Row; include?: Row } = {}) {
    const row = this.rows.find((r) => matches(r, where, this.relations));
    return row ? this.attach(row, include) : null;
  }

  async findMany({
    where,
    include,
    orderBy,
    take,
  }: { where?: Row; include?: Row; orderBy?: any; take?: number } = {}) {
    let out = this.rows.filter((r) => matches(r, where, this.relations)).map((r) => this.attach(r, include));
    if (orderBy) {
      const [[field, dir]] = Object.entries(orderBy) as [string, string][];
      out = out.sort((a, b) => (a[field] > b[field] ? 1 : a[field] < b[field] ? -1 : 0));
      if (dir === "desc") out.reverse();
    }
    if (take) out = out.slice(0, take);
    return out;
  }

  async count({ where }: { where?: Row } = {}) {
    return this.rows.filter((r) => matches(r, where, this.relations)).length;
  }

  async create({ data }: { data: Row }) {
    const row = { ...data, createdAt: data.createdAt || new Date(), updatedAt: new Date() };
    this.rows.push(row);
    return { ...row };
  }

  async update({ where, data, include }: { where: Row; data: Row; include?: Row }) {
    const row = this.rows.find((r) => matches(r, where, this.relations));
    if (!row) throw new Error(`${this.name}: record not found`);
    Object.assign(row, data, { updatedAt: new Date() });
    return this.attach(row, include);
  }

  async updateMany({ where, data }: { where?: Row; data: Row }) {
    const rows = this.rows.filter((r) => matches(r, where, this.relations));
    for (const row of rows) Object.assign(row, data, { updatedAt: new Date() });
    return { count: rows.length };
  }

  async delete({ where }: { where: Row }) {
    const idx = this.rows.findIndex((r) => matches(r, where, this.relations));
    if (idx === -1) throw new Error(`${this.name}: record not found`);
    const [row] = this.rows.splice(idx, 1);
    return row;
  }
}

export function createFakePrisma() {
  const competition = new Table("competition");
  const submission = new Table("submission");
  const dispute = new Table("dispute");
  const user = new Table("user");

  submission.relations.user = { table: () => user, fk: "userId" };
  submission.relations.competition = { table: () => competition, fk: "competitionId" };
  dispute.relations.user = { table: () => user, fk: "userId" };
  dispute.relations.submission = { table: () => submission, fk: "submissionId" };

  return { competition, submission, dispute, user };
}

export type FakePrisma = ReturnType<typeof createFakePrisma>;

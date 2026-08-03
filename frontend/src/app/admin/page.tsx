"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, getUser } from "@/lib/api";
import {
  GlassCard,
  MonoLabel,
  PrestigeButton,
  GhostButton,
  StatusChip,
  TerminalField,
} from "@/components/ui";

type Overview = {
  users: number;
  submissions: number;
  competitions: number;
  disputes: number;
  chainConfigured: boolean;
  contractInfo: { total_evaluations?: number; active_competition_id?: string } | null;
};

type Dispute = {
  id: string;
  submissionId: string;
  reason: string;
  evidenceUrl: string;
  status: string;
  username: string;
  submission: { title: string; imageUrl: string };
};

export default function Admin() {
  const router = useRouter();
  const [data, setData] = useState<Overview | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [openDisputes, setOpenDisputes] = useState<Dispute[]>([]);
  const [resolvingId, setResolvingId] = useState("");
  const [newArena, setNewArena] = useState({
    id: "",
    title: "",
    theme: "",
    startsAt: "",
    endsAt: "",
    open: true,
  });
  const [markFailedIds, setMarkFailedIds] = useState("");

  function loadDisputes() {
    api<{ disputes: Dispute[] }>("/api/disputes")
      .then((r) => setOpenDisputes(r.disputes.filter((d) => d.status === "open")))
      .catch(() => undefined);
  }

  useEffect(() => {
    const u = getUser();
    if (!u) return router.push("/login");
    if (u.role !== "admin") return router.push("/dashboard");
    api<Overview>("/api/admin/overview").then(setData).catch((e) => setLog([`ERROR: ${e.message}`]));
    loadDisputes();
  }, [router]);

  async function run(path: string, label: string, body?: unknown) {
    setBusy(true);
    setLog((p) => [...p, `> ${label}…`]);
    try {
      const res = await api(path, { method: "POST", body: JSON.stringify(body ?? {}) });
      setLog((p) => [...p, `> ${label}: ${JSON.stringify(res)}`]);
      return res;
    } catch (err) {
      setLog((p) => [...p, `> ${label} FAILED: ${(err as Error).message}`]);
      throw err;
    } finally {
      setBusy(false);
    }
  }

  async function resolveDispute(id: string) {
    setResolvingId(id);
    try {
      await run(`/api/admin/resolve-dispute/${id}`, `Resolve dispute ${id}`);
      loadDisputes();
    } catch {
      /* logged already */
    } finally {
      setResolvingId("");
    }
  }

  async function createArena(e: React.FormEvent) {
    e.preventDefault();
    try {
      await run("/api/admin/competitions", `Create arena ${newArena.id}`, {
        ...newArena,
        startsAt: new Date(newArena.startsAt).toISOString(),
        endsAt: new Date(newArena.endsAt).toISOString(),
      });
      setNewArena({ id: "", title: "", theme: "", startsAt: "", endsAt: "", open: true });
    } catch {
      /* logged already */
    }
  }

  async function markFailed(e: React.FormEvent) {
    e.preventDefault();
    const competitionIds = markFailedIds
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (competitionIds.length === 0) return;
    try {
      await run("/api/admin/mark-failed", `Mark failed (${competitionIds.length} arenas)`, {
        competitionIds,
      });
      setMarkFailedIds("");
    } catch {
      /* logged already */
    }
  }

  return (
    <main className="px-4 md:px-12 py-8 max-w-arena mx-auto space-y-8">
      <header className="flex justify-between items-end">
        <div>
          <MonoLabel className="text-purple-soft block mb-2">OLYMPUS CONTROL</MonoLabel>
          <h1 className="font-display font-bold text-4xl">ADMIN PANEL</h1>
        </div>
        <StatusChip
          label={data?.chainConfigured ? "Contract connected" : "Contract not configured"}
          tone={data?.chainConfigured ? "cyan" : "muted"}
        />
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          ["Users", data?.users],
          ["Submissions", data?.submissions],
          ["Competitions", data?.competitions],
          ["Disputes", data?.disputes],
        ].map(([label, value]) => (
          <GlassCard key={label as string} className="p-6">
            <MonoLabel>{label}</MonoLabel>
            <div className="font-display font-bold text-4xl text-cyan-soft mt-2">{value ?? "—"}</div>
          </GlassCard>
        ))}
      </div>

      <GlassCard className="p-8">
        <h2 className="font-display font-semibold text-xl mb-6">Lifecycle Controls</h2>
        <div className="flex flex-wrap gap-4">
          <PrestigeButton disabled={busy} onClick={() => run("/api/admin/rollover", "Weekly rollover")}>
            Run Weekly Rollover
          </PrestigeButton>
          <GhostButton disabled={busy} onClick={() => run("/api/admin/judge-sweep", "Judging sweep")}>
            Run Judging Sweep
          </GhostButton>
        </div>
        <p className="font-mono text-[11px] text-on-variant mt-4">
          These also run automatically: rollover Mondays 00:05 UTC; close,
          judging and finalization all kick in as soon as an arena's weekly
          deadline passes, not on any fixed hourly/minute-based clock.
        </p>
      </GlassCard>

      <GlassCard className="p-8">
        <h2 className="font-display font-semibold text-xl mb-2">
          Open Disputes {openDisputes.length > 0 && `(${openDisputes.length})`}
        </h2>
        <p className="font-mono text-[11px] text-on-variant mb-6">
          Resolving reruns the contract's evidence-based validator ruling —
          fetches the submitted evidence URL on-chain itself, never decided
          from the text alone.
        </p>
        {openDisputes.length === 0 ? (
          <p className="font-mono text-sm text-on-variant">No open disputes.</p>
        ) : (
          <div className="space-y-3">
            {openDisputes.map((d) => (
              <div
                key={d.id}
                className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-black/30 rounded-lg p-4 border border-white/5"
              >
                <div className="min-w-0">
                  <p className="font-display font-semibold text-sm truncate">
                    {d.submission.title || "Untitled"}{" "}
                    <span className="text-cyan-soft font-mono text-xs">by @{d.username}</span>
                  </p>
                  <p className="text-on-variant text-xs mt-1 line-clamp-2">{d.reason}</p>
                  <a
                    href={d.evidenceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-[10px] text-gold-soft underline break-all"
                  >
                    {d.evidenceUrl}
                  </a>
                </div>
                <GhostButton
                  disabled={busy || resolvingId === d.id}
                  onClick={() => resolveDispute(d.id)}
                  className="shrink-0"
                >
                  {resolvingId === d.id ? "RESOLVING…" : "Resolve"}
                </GhostButton>
              </div>
            ))}
          </div>
        )}
      </GlassCard>

      <GlassCard className="p-8">
        <h2 className="font-display font-semibold text-xl mb-6">Create Arena Now</h2>
        <form onSubmit={createArena} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <TerminalField
            label="Slug id (e.g. arena-special-event)"
            value={newArena.id}
            onChange={(e) => setNewArena({ ...newArena, id: e.target.value })}
            required
          />
          <TerminalField
            label="Title"
            value={newArena.title}
            onChange={(e) => setNewArena({ ...newArena, title: e.target.value })}
            required
          />
          <div className="md:col-span-2">
            <TerminalField
              label="Theme (optional)"
              value={newArena.theme}
              onChange={(e) => setNewArena({ ...newArena, theme: e.target.value })}
            />
          </div>
          <TerminalField
            label="Starts at"
            type="datetime-local"
            value={newArena.startsAt}
            onChange={(e) => setNewArena({ ...newArena, startsAt: e.target.value })}
            required
          />
          <TerminalField
            label="Ends at"
            type="datetime-local"
            value={newArena.endsAt}
            onChange={(e) => setNewArena({ ...newArena, endsAt: e.target.value })}
            required
          />
          <label className="flex items-center gap-2 font-mono text-xs text-on-variant md:col-span-2">
            <input
              type="checkbox"
              checked={newArena.open}
              onChange={(e) => setNewArena({ ...newArena, open: e.target.checked })}
            />
            Open for submissions immediately
          </label>
          <div className="md:col-span-2">
            <PrestigeButton type="submit" disabled={busy}>
              Create Arena
            </PrestigeButton>
          </div>
        </form>
      </GlassCard>

      <GlassCard className="p-8">
        <h2 className="font-display font-semibold text-xl mb-2">Mark Submissions Failed</h2>
        <p className="font-mono text-[11px] text-on-variant mb-6">
          Maintenance only — flags pending/onchain submissions in the given
          arenas (comma-separated ids) so the judging sweep stops retrying
          them, e.g. after a contract redeploy orphaned them.
        </p>
        <form onSubmit={markFailed} className="flex flex-col md:flex-row gap-4 md:items-end">
          <div className="flex-1">
            <TerminalField
              label="Competition ids"
              value={markFailedIds}
              onChange={(e) => setMarkFailedIds(e.target.value)}
              placeholder="arena-old-one, week-2026-30"
            />
          </div>
          <GhostButton type="submit" disabled={busy || !markFailedIds.trim()}>
            Mark Failed
          </GhostButton>
        </form>
      </GlassCard>

      <GlassCard className="p-6 bg-black/40">
        <MonoLabel className="text-cyan-soft block mb-4">OPERATIONS_LOG</MonoLabel>
        <div className="font-mono text-[11px] space-y-1 text-on-variant max-h-64 overflow-y-auto">
          {log.length === 0 ? <div>&gt; Standing by.</div> : log.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      </GlassCard>
    </main>
  );
}

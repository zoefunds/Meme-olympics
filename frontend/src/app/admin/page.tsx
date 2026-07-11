"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, getUser } from "@/lib/api";
import { GlassCard, MonoLabel, PrestigeButton, GhostButton, StatusChip } from "@/components/ui";

type Overview = {
  users: number;
  submissions: number;
  competitions: number;
  disputes: number;
  chainConfigured: boolean;
  contractInfo: { total_evaluations?: number; active_competition_id?: string } | null;
};

export default function Admin() {
  const router = useRouter();
  const [data, setData] = useState<Overview | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const u = getUser();
    if (!u) return router.push("/login");
    if (u.role !== "admin") return router.push("/dashboard");
    api<Overview>("/api/admin/overview").then(setData).catch((e) => setLog([`ERROR: ${e.message}`]));
  }, [router]);

  async function run(path: string, label: string) {
    setBusy(true);
    setLog((p) => [...p, `> ${label}…`]);
    try {
      const res = await api(path, { method: "POST", body: "{}" });
      setLog((p) => [...p, `> ${label}: ${JSON.stringify(res)}`]);
    } catch (err) {
      setLog((p) => [...p, `> ${label} FAILED: ${(err as Error).message}`]);
    } finally {
      setBusy(false);
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
          These also run automatically: rollover Mondays 00:05 UTC, judging
          hourly at :15, finalization hourly at :45.
        </p>
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

"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { GlassCard, MonoLabel, StatusChip, PrestigeButton, GhostButton } from "@/components/ui";

/* Arena Detail — the missing page: clicking an arena from the browse list
   used to jump straight to the leaderboard, skipping the actual competition
   info a submitter needs (theme/rules, deadline, real staked prize, entry
   count, host) before deciding to enter or dig into rankings. */

type Comp = {
  id: string;
  title: string;
  theme: string;
  status: string;
  startsAt: string;
  endsAt: string;
  prizeAtto: string;
  createdByUserId?: string;
  onchainCreated: boolean;
  winners: Array<{ author: string; rank: number; reward_atto: string; score: number }>;
};

const STATUS_TONE: Record<string, "cyan" | "gold" | "muted"> = {
  open: "cyan",
  judging: "gold",
  finalized: "gold",
  created: "muted",
  cancelled: "muted",
};

const STATUS_COPY: Record<string, string> = {
  open: "Open for submissions",
  judging: "Submissions closed — validators are judging",
  finalized: "Finalized — rewards settled",
  created: "Not yet open",
  cancelled: "Cancelled",
};

function genAmount(atto?: string): string {
  if (!atto) return "0";
  const gen = Number(BigInt(atto) / BigInt(10 ** 14)) / 10000;
  return gen.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function useCountdown(endsAt?: string, active?: boolean) {
  const [left, setLeft] = useState("");
  useEffect(() => {
    if (!endsAt || !active) return;
    const tick = () => {
      const ms = new Date(endsAt).getTime() - Date.now();
      if (ms <= 0) return setLeft("closing…");
      const d = Math.floor(ms / 86400000);
      const h = Math.floor((ms % 86400000) / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      setLeft(d > 0 ? `${d}d ${h}h left` : h > 0 ? `${h}h ${m}m left` : `${m}m left`);
    };
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, [endsAt, active]);
  return left;
}

export default function ArenaDetail() {
  const params = useParams<{ id: string }>();
  const [comp, setComp] = useState<Comp | null>(null);
  const [subCount, setSubCount] = useState<number | null>(null);
  const [error, setError] = useState("");
  const countdown = useCountdown(comp?.endsAt, comp?.status === "open");

  useEffect(() => {
    if (!params?.id) return;
    const load = () => {
      api<Comp>(`/api/competitions/${params.id}`)
        .then(setComp)
        .catch((e) => setError((e as Error).message));
      api<{ leaderboard: unknown[] }>(`/api/competitions/${params.id}/leaderboard`)
        .then((r) => setSubCount(r.leaderboard.length))
        .catch(() => undefined);
    };
    load();
    const id = setInterval(load, 20000);
    return () => clearInterval(id);
  }, [params?.id]);

  if (error) {
    return (
      <main className="px-4 md:px-12 py-16 max-w-2xl mx-auto">
        <GlassCard className="p-10 text-center">
          <p className="font-mono text-sm text-danger">{error}</p>
        </GlassCard>
      </main>
    );
  }
  if (!comp) {
    return (
      <main className="px-4 md:px-12 py-16 max-w-2xl mx-auto">
        <GlassCard className="p-10 text-center" scan>
          <p className="font-mono text-sm text-on-variant">Loading arena…</p>
        </GlassCard>
      </main>
    );
  }

  return (
    <main className="px-4 md:px-12 py-8 max-w-arena mx-auto space-y-8">
      <Link href="/arenas" className="font-mono text-xs text-on-variant hover:text-white inline-block">
        ← All Arenas
      </Link>

      <GlassCard className="p-8 md:p-12 border-gold/20 prestige-glow" scan={comp.status === "open"}>
        <div className="flex flex-col md:flex-row justify-between gap-8">
          <div className="max-w-2xl">
            <div className="flex items-center gap-3 mb-4">
              <StatusChip label={comp.status.toUpperCase()} tone={STATUS_TONE[comp.status] || "muted"} />
              <span className="font-mono text-xs text-on-variant">{STATUS_COPY[comp.status]}</span>
            </div>
            <h1 className="font-display font-bold text-4xl md:text-5xl mb-4">{comp.title}</h1>
            <p className="text-on-variant leading-relaxed">{comp.theme}</p>
          </div>
          <div className="flex flex-col gap-4 md:items-end">
            <div className="text-right">
              <MonoLabel>Prize Pool (real GEN)</MonoLabel>
              <p className="font-display font-bold text-gold text-3xl">{genAmount(comp.prizeAtto)} GEN</p>
            </div>
            {comp.status === "open" && countdown && (
              <div className="text-right">
                <MonoLabel>Time Remaining</MonoLabel>
                <p className="font-display text-cyan-soft text-xl">{countdown}</p>
              </div>
            )}
          </div>
        </div>

        <div className="receipt-divider mt-8 pt-6 flex flex-wrap gap-4">
          {comp.status === "open" && (
            <Link href={`/submit?arena=${comp.id}`}>
              <PrestigeButton>Submit Meme</PrestigeButton>
            </Link>
          )}
          <Link href={`/leaderboard?arena=${comp.id}`}>
            <GhostButton>View Leaderboard</GhostButton>
          </Link>
        </div>
      </GlassCard>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          ["Entries Judged", subCount ?? "—"],
          ["Starts", new Date(comp.startsAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })],
          ["Ends", new Date(comp.endsAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })],
          ["On-chain", comp.onchainCreated ? "✓ registered" : "pending"],
        ].map(([label, value]) => (
          <GlassCard key={label as string} className="p-5">
            <MonoLabel>{label}</MonoLabel>
            <p className="font-display font-semibold text-lg mt-1 break-words">{String(value)}</p>
          </GlassCard>
        ))}
      </div>

      {comp.winners.length > 0 && (
        <section>
          <h2 className="font-display font-semibold text-2xl mb-4 uppercase">Winners</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {comp.winners.map((w) => (
              <GlassCard key={w.rank} className="p-5 border-gold-dim/30">
                <MonoLabel>Rank #{w.rank}</MonoLabel>
                <p className="font-mono text-xs text-cyan-soft break-all mt-1">{w.author}</p>
                <div className="receipt-divider mt-3 pt-3 flex justify-between font-mono text-xs">
                  <span className="text-on-variant">Score {w.score}/100</span>
                  <span className="text-gold-dim">{genAmount(w.reward_atto)} GEN</span>
                </div>
              </GlassCard>
            ))}
          </div>
        </section>
      )}

      <GlassCard className="p-6 bg-black/40">
        <MonoLabel className="text-cyan-soft block mb-3">How judging works here</MonoLabel>
        <p className="font-mono text-xs text-on-variant leading-relaxed">
          &gt; GenLayer validators independently score every entry across 9
          weighted criteria. The leader judges first; every validator
          re-derives the score itself, and only agreement within tolerance
          settles a result — nothing here is graded by a single AI opinion.
          Submissions are judged strictly one at a time once this arena
          closes, and rewards settle to winners&apos; wallets via a self-serve
          on-chain claim.
        </p>
      </GlassCard>
    </main>
  );
}

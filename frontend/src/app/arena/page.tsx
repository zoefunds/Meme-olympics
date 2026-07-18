"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { GlassCard, MonoLabel, SegmentedBar, StatusChip } from "@/components/ui";

/* The Arena — modelled on The-Arena prototype: gold hero with countdown +
   prize pool, top contenders grid with segmented AI metric bars. */

type Comp = {
  active: boolean;
  id?: string;
  title?: string;
  theme?: string;
  endsAt?: string;
  submissionCount?: number;
  prizeAtto?: string;
};

function genAmount(atto?: string): string {
  if (!atto) return "0";
  const gen = Number(BigInt(atto) / BigInt(10 ** 14)) / 10000;
  return gen.toLocaleString(undefined, { maximumFractionDigits: 4 });
}
type Entry = {
  rank: number;
  submissionId: string;
  title: string;
  imageUrl: string;
  username: string;
  score: number;
  criteria: Record<string, number>;
  status: string;
};

function useCountdown(endsAt?: string) {
  const [left, setLeft] = useState("--D : --H : --M");
  useEffect(() => {
    if (!endsAt) return;
    const tick = () => {
      const ms = new Date(endsAt).getTime() - Date.now();
      if (ms <= 0) return setLeft("JUDGING…");
      const d = Math.floor(ms / 86400000);
      const h = Math.floor((ms % 86400000) / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      setLeft(`${String(d).padStart(2, "0")}D : ${String(h).padStart(2, "0")}H : ${String(m).padStart(2, "0")}M`);
    };
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, [endsAt]);
  return left;
}

export default function Arena() {
  const [comp, setComp] = useState<Comp | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const countdown = useCountdown(comp?.endsAt);

  useEffect(() => {
    const load = () =>
      api<Comp>("/api/competitions/active")
        .then(async (c) => {
          setComp(c);
          if (c.active && c.id) {
            const lb = await api<{ leaderboard: Entry[] }>(
              `/api/competitions/${c.id}/leaderboard`
            );
            setEntries(lb.leaderboard.slice(0, 9));
          }
        })
        .catch(() => setComp({ active: false }));
    load();
    // Submission count and scores change as the arena fills up and judging
    // runs — poll so this stays live without a manual reload.
    const id = setInterval(load, 20000);
    return () => clearInterval(id);
  }, []);

  return (
    <main className="px-4 md:px-12 py-8 max-w-arena mx-auto space-y-12">
      {/* Hero */}
      <GlassCard className="p-8 md:p-12 border-gold/20 prestige-glow">
        <div className="scanline-texture absolute inset-0 opacity-30" />
        <div className="flex flex-col md:flex-row justify-between gap-8 relative z-10">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-gold/10 border border-gold/30 rounded-full mb-6">
              <span className="w-2 h-2 rounded-full bg-gold animate-pulse" />
              <span className="font-mono text-xs text-gold uppercase tracking-tight">
                {comp?.active ? comp.title : "Arena warming up"}
              </span>
            </div>
            <h1 className="font-display font-bold text-4xl md:text-6xl text-white mb-4 uppercase leading-tight">
              Meme Olympics Arena
            </h1>
            <p className="text-on-variant mb-8 max-w-lg">
              {comp?.theme ||
                "Submit your most viral-worthy creations to the GenLayer AI judges. Objective scoring meets absolute prestige — cryptographically verified."}
            </p>
            <div className="flex flex-wrap gap-6 items-center">
              <div className="flex flex-col">
                <MonoLabel>Prize Pool (real GEN)</MonoLabel>
                <p className="font-display font-bold text-gold text-4xl">
                  {genAmount(comp?.prizeAtto)} <span className="text-xl text-on-variant">GEN</span>
                </p>
              </div>
              <Link
                href="/submit"
                className="prestige-btn px-10 py-4 rounded-lg font-display text-lg font-extrabold uppercase inline-block"
              >
                Submit Meme
              </Link>
              <Link
                href="/competitions/new"
                className="border border-white/20 bg-white/5 px-8 py-4 rounded-lg backdrop-blur-md font-display text-sm font-semibold uppercase tracking-widest hover:bg-white/10 transition-all inline-block"
              >
                Host an Arena
              </Link>
            </div>
          </div>
          <div className="self-start bg-surface-highest/80 backdrop-blur-md border border-white/10 px-6 py-4 rounded-lg">
            <MonoLabel>Time Remaining</MonoLabel>
            <p className="font-display text-gold text-2xl tracking-widest mt-1">{countdown}</p>
            <p className="font-mono text-[10px] text-on-variant mt-2">
              {comp?.submissionCount ?? 0} entries in the arena
            </p>
          </div>
        </div>
      </GlassCard>

      {/* Top contenders */}
      <section>
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="font-display font-bold text-3xl text-white uppercase">Top Contenders</h2>
            <div className="flex items-center gap-2 mt-1">
              <StatusChip label="Verified by GenLayer consensus" />
            </div>
          </div>
        </div>
        {entries.length === 0 ? (
          <GlassCard className="p-12 text-center">
            <p className="font-mono text-sm text-on-variant">
              No judged entries yet this week. The AI judges are waiting —{" "}
              <Link href="/submit" className="text-gold-soft">be the first</Link>.
            </p>
          </GlassCard>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {entries.map((e) => (
              <Link key={e.submissionId} href={`/meme/${e.submissionId}`} className="block">
              <GlassCard className="group hover:border-cyan/50 transition-all duration-500 cursor-pointer">
                <div className="relative h-64 overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={e.imageUrl}
                    alt={e.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                  />
                  <div className="absolute top-4 left-4 bg-background/80 backdrop-blur-md px-3 py-1 rounded-full border border-white/10 flex items-center gap-2">
                    <span className="pulse-dot" />
                    <span className="font-mono text-[10px] text-white uppercase tracking-widest">AI Ranked</span>
                  </div>
                  <div className="absolute bottom-0 inset-x-0 p-4 bg-gradient-to-t from-background/90 to-transparent">
                    <p className="font-display font-semibold text-white text-xl">{e.title}</p>
                    <p className="font-mono text-purple-soft text-xs">@{e.username}</p>
                  </div>
                </div>
                <div className="p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <MonoLabel>GenLayer Score</MonoLabel>
                    <span className="font-display text-cyan text-2xl font-bold">{e.score}</span>
                  </div>
                  <div className="space-y-2">
                    {["originality", "humor", "crypto_native_understanding"].map((c) => (
                      <div key={c}>
                        <div className="flex justify-between text-[10px] uppercase font-mono text-on-variant mb-1">
                          <span>{c.replace(/_/g, " ")}</span>
                          <span>{(e.criteria[c] ?? 0) * 10}%</span>
                        </div>
                        <SegmentedBar
                          percent={(e.criteria[c] ?? 0) * 10}
                          gold={c === "crypto_native_understanding"}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </GlassCard>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Intelligent contract info */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <GlassCard className="p-8 border-purple/20">
          <h3 className="font-display font-semibold text-white text-xl mb-4">
            🧠 Intelligent Contract Judging
          </h3>
          <p className="text-on-variant mb-6 leading-relaxed text-sm">
            Every submission is analyzed by GenLayer&apos;s decentralized AI
            validators. The judging logic lives inside an{" "}
            <span className="text-purple-soft font-bold">Intelligent Contract</span>{" "}
            — scoring rules are transparent, tamper-proof, and executed on-chain.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white/5 p-4 rounded-lg">
              <h4 className="font-mono text-[11px] text-white uppercase mb-1">Full Transparency</h4>
              <p className="text-[11px] text-on-variant">Per-criterion scores and verdicts for every meme.</p>
            </div>
            <div className="bg-white/5 p-4 rounded-lg">
              <h4 className="font-mono text-[11px] text-white uppercase mb-1">Anti-Bribe Logic</h4>
              <p className="text-[11px] text-on-variant">Validator consensus prevents biased scoring.</p>
            </div>
          </div>
        </GlassCard>
        <GlassCard className="p-8 border-gold/20 flex flex-col justify-center items-center text-center">
          <div className="w-16 h-16 rounded-full bg-gold/10 border border-gold/30 flex items-center justify-center mb-4 text-3xl">
            🥇
          </div>
          <h3 className="font-display font-semibold text-white text-xl mb-2 uppercase">Become a Champion</h3>
          <p className="text-on-variant mb-6 text-sm">
            Weekly podium finishers earn reward points settled on-chain, plus a
            permanent place in the Hall of Glory.
          </p>
          <Link href="/leaderboard" className="px-8 py-3 bg-white/5 border border-white/10 rounded-lg font-display text-white hover:bg-white/10 transition-colors uppercase tracking-widest text-xs">
            View Hall of Glory
          </Link>
        </GlassCard>
      </section>
    </main>
  );
}

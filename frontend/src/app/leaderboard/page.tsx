"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { GlassCard, MonoLabel, StatusChip } from "@/components/ui";

/* Hall of Glory — modelled on the EliteHall prototype: podium cards for the
   top 3 with gold glow + receipt dividers, then a detailed rankings table. */

type Comp = { id: string; title: string; status: string };
type Entry = {
  rank: number;
  submissionId: string;
  title: string;
  imageUrl: string;
  username: string;
  score: number;
  status: string;
  plagiarismVerdict: string;
};

function LeaderboardInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const arenaParam = searchParams.get("arena");
  const [comps, setComps] = useState<Comp[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [entries, setEntries] = useState<Entry[]>([]);

  useEffect(() => {
    api<{ competitions: Comp[] }>("/api/competitions").then((r) => {
      setComps(r.competitions);
      if (arenaParam && r.competitions.some((c) => c.id === arenaParam)) {
        setSelected(arenaParam);
      } else if (r.competitions[0]) {
        setSelected(r.competitions[0].id);
      }
    }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selected) return;
    const load = () =>
      api<{ leaderboard: Entry[] }>(`/api/competitions/${selected}/leaderboard`)
        .then((r) => setEntries(r.leaderboard))
        .catch(() => setEntries([]));
    load();
    // Scores land one meme at a time as judging progresses — poll so
    // rankings update live instead of needing a manual reload.
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [selected]);

  const podium = entries.slice(0, 3);
  const rest = entries.slice(3);

  return (
    <main className="px-4 md:px-12 py-8 max-w-arena mx-auto">
      <section className="mb-12">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 mb-8">
          <div>
            <MonoLabel className="text-gold-dim tracking-[0.2em] block mb-2">Global Rankings</MonoLabel>
            <h1 className="font-display font-bold text-4xl md:text-5xl leading-tight">HALL OF GLORY</h1>
          </div>
          <div className="flex gap-2 bg-surface-high p-1 rounded-lg border border-white/5 overflow-x-auto max-w-full">
            {comps.slice(0, 4).map((c) => (
              <button
                key={c.id}
                onClick={() => setSelected(c.id)}
                className={`px-4 py-2 rounded font-display text-xs font-semibold whitespace-nowrap uppercase ${
                  selected === c.id
                    ? "bg-gold-dim text-on-gold shadow-inner"
                    : "text-on-variant hover:text-on-surface"
                }`}
              >
                {c.id.replace("week-", "W")}
              </button>
            ))}
          </div>
        </div>

        {/* Podium */}
        {podium.length === 0 ? (
          <GlassCard className="p-12 text-center">
            <p className="font-mono text-sm text-on-variant">No judged entries for this competition yet.</p>
          </GlassCard>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {podium.map((e) => (
              <Link key={e.submissionId} href={`/meme/${e.submissionId}`} className="block">
              <GlassCard
                className={`group cursor-pointer ${e.rank === 1 ? "border-gold-dim/30 prestige-glow" : ""}`}
                scan={e.rank === 1}
              >
                <div
                  className={`absolute top-4 right-4 z-20 font-mono px-3 py-1 rounded-full text-xs font-bold tracking-tighter ${
                    e.rank === 1 ? "bg-gold-dim text-black" : "bg-on-variant/20 text-on-variant"
                  }`}
                >
                  RANK #{e.rank}
                </div>
                <div className="h-64 relative overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={e.imageUrl}
                    alt={e.title}
                    className={`w-full h-full object-cover group-hover:scale-110 transition-transform duration-700 ${e.rank > 1 ? "opacity-80" : ""}`}
                  />
                </div>
                <div className="p-6">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className={`font-display font-semibold text-2xl leading-none mb-1 ${e.rank === 1 ? "text-cream" : "text-on-surface"}`}>
                        {e.title}
                      </h3>
                      <p className="font-mono text-xs text-on-variant">by @{e.username}</p>
                    </div>
                    <div className="text-right">
                      <MonoLabel className={e.rank === 1 ? "text-gold-dim" : ""}>AI Score</MonoLabel>
                      <div className={`font-display font-bold text-3xl ${e.rank === 1 ? "text-gold-dim" : "text-on-surface"}`}>
                        {e.score}
                      </div>
                    </div>
                  </div>
                  <div className="receipt-divider pt-4 flex justify-between items-center">
                    <div className="flex flex-col">
                      <span className="font-mono text-[10px] text-on-variant">STATUS</span>
                      <span className="font-mono text-cream text-xs uppercase">{e.status}</span>
                    </div>
                    <StatusChip
                      label={e.status === "winner" ? "GENLAYER VALIDATED" : "CONSENSUS REACHED"}
                      tone={e.rank === 1 ? "cyan" : "muted"}
                    />
                  </div>
                </div>
              </GlassCard>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Detailed table */}
      {rest.length > 0 && (
        <GlassCard className="rounded-2xl">
          <div className="p-6 border-b border-white/10 flex justify-between items-center bg-white/5">
            <h3 className="font-display font-semibold text-2xl text-gold-dim">Detailed Rankings</h3>
            <MonoLabel>Sort: AI Score</MonoLabel>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="font-mono text-xs uppercase text-on-variant border-b border-white/5">
                  <th className="px-6 py-4 font-normal">Rank</th>
                  <th className="px-6 py-4 font-normal">Meme</th>
                  <th className="px-6 py-4 font-normal">Creator</th>
                  <th className="px-6 py-4 font-normal">AI Score</th>
                  <th className="px-6 py-4 font-normal">Originality</th>
                  <th className="px-6 py-4 font-normal">Status</th>
                </tr>
              </thead>
              <tbody>
                {rest.map((e) => (
                  <tr
                    key={e.submissionId}
                    onClick={() => router.push(`/meme/${e.submissionId}`)}
                    className="border-b border-white/5 hover:bg-white/5 transition-all cursor-pointer"
                  >
                    <td className="px-6 py-5 font-mono text-gold-soft">#{e.rank}</td>
                    <td className="px-6 py-5">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded bg-surface-high overflow-hidden">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={e.imageUrl} alt="" className="w-full h-full object-cover" />
                        </div>
                        <span className="font-medium">{e.title}</span>
                      </div>
                    </td>
                    <td className="px-6 py-5 text-on-variant">@{e.username}</td>
                    <td className="px-6 py-5">
                      <div className="flex items-center gap-3">
                        <span className="font-mono">{e.score}</span>
                        <div className="w-24 h-1.5 bg-surface-high rounded-full overflow-hidden">
                          <div className="h-full bg-gold-dim" style={{ width: `${e.score}%` }} />
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-5 font-mono text-xs uppercase">{e.plagiarismVerdict || "—"}</td>
                    <td className="px-6 py-5">
                      <span className="text-[10px] font-mono uppercase tracking-widest bg-cyan-dim/20 text-cyan-dim px-2 py-1 rounded">
                        {e.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlassCard>
      )}
    </main>
  );
}

export default function Leaderboard() {
  return (
    <Suspense>
      <LeaderboardInner />
    </Suspense>
  );
}

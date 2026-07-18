"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, getUser } from "@/lib/api";
import { GlassCard, MonoLabel, SegmentedBar, StatusChip } from "@/components/ui";

type Sub = {
  id: string;
  title: string;
  imageUrl: string;
  status: string;
  totalScore: number;
  criteria: Record<string, number>;
  plagiarismVerdict: string;
  evaluationSummary: string;
  competitionId: string;
  createdAt: string;
};

const STATUS_TONE: Record<string, "cyan" | "gold" | "muted"> = {
  winner: "gold",
  evaluated: "cyan",
  onchain: "muted",
  pending: "muted",
  disqualified: "muted",
};

export default function Dashboard() {
  const router = useRouter();
  const [subs, setSubs] = useState<Sub[]>([]);
  const user = typeof window !== "undefined" ? getUser() : null;

  useEffect(() => {
    if (!getUser()) return router.push("/login");
    const load = () =>
      api<{ submissions: Sub[] }>("/api/submissions/mine")
        .then((r) => setSubs(r.submissions))
        .catch(() => undefined);
    load();
    // Judging happens async on-chain (30-60s per meme) — poll so status
    // moves from pending -> onchain -> evaluated without a manual reload.
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [router]);

  const wins = subs.filter((s) => s.status === "winner").length;
  const judged = subs.filter((s) => ["evaluated", "winner"].includes(s.status));
  const avg = judged.length
    ? Math.round(judged.reduce((a, s) => a + s.totalScore, 0) / judged.length)
    : 0;

  return (
    <main className="px-4 md:px-12 py-8 max-w-arena mx-auto space-y-10">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <MonoLabel className="text-cyan-dim block mb-2">COMPETITOR CONSOLE</MonoLabel>
          <h1 className="font-display font-bold text-4xl">
            Welcome back{user ? `, @${user.username}` : ""}
          </h1>
        </div>
        <Link href="/submit" className="prestige-btn px-8 py-3 rounded font-display text-sm font-bold uppercase tracking-widest">
          Submit Meme
        </Link>
      </header>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          ["Submissions", subs.length],
          ["Wins", wins],
          ["Avg AI Score", avg],
          ["Judged", judged.length],
        ].map(([label, value]) => (
          <GlassCard key={label as string} className="p-6">
            <MonoLabel>{label}</MonoLabel>
            <div className="font-display font-bold text-4xl text-gold-soft mt-2">{value}</div>
          </GlassCard>
        ))}
      </div>

      {/* Wallet */}
      {user && (
        <GlassCard className="p-6 flex flex-col md:flex-row justify-between md:items-center gap-4">
          <div>
            <MonoLabel>Your GenLayer Wallet (permanently linked)</MonoLabel>
            <p className="font-mono text-sm text-cyan-soft break-all mt-1">{user.walletAddress}</p>
          </div>
          <Link href="/settings" className="font-mono text-xs text-on-variant hover:text-white uppercase">
            Export key →
          </Link>
        </GlassCard>
      )}

      {/* Submissions */}
      <section>
        <h2 className="font-display font-semibold text-2xl mb-6 uppercase">My Entries</h2>
        {subs.length === 0 ? (
          <GlassCard className="p-12 text-center">
            <p className="font-mono text-sm text-on-variant">
              No entries yet. <Link href="/submit" className="text-gold-soft">Enter the arena →</Link>
            </p>
          </GlassCard>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {subs.map((s) => (
              <Link key={s.id} href={`/meme/${s.id}`} className="block">
              <GlassCard className="group cursor-pointer hover:border-cyan/40 transition-colors">
                <div className="relative h-48 overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.imageUrl} alt={s.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
                  <div className="absolute top-3 right-3">
                    <StatusChip
                      label={s.status.toUpperCase()}
                      tone={STATUS_TONE[s.status] || "muted"}
                    />
                  </div>
                </div>
                <div className="p-5 space-y-3">
                  <div className="flex justify-between items-center">
                    <p className="font-display font-semibold">{s.title}</p>
                    {["evaluated", "winner"].includes(s.status) && (
                      <span className="font-display font-bold text-cyan text-xl">{s.totalScore}</span>
                    )}
                  </div>
                  {["evaluated", "winner"].includes(s.status) && (
                    <>
                      <SegmentedBar percent={s.totalScore} gold={s.status === "winner"} />
                      {s.evaluationSummary && (
                        <p className="font-mono text-[11px] text-on-variant receipt-divider pt-3">
                          “{s.evaluationSummary}”
                        </p>
                      )}
                    </>
                  )}
                  {s.status === "disqualified" && (
                    <p className="font-mono text-[11px] text-danger receipt-divider pt-3">
                      Disqualified — verdict: {s.plagiarismVerdict || "plagiarism"}.
                    </p>
                  )}
                  {["pending", "onchain"].includes(s.status) && (
                    <p className="font-mono text-[11px] text-on-variant receipt-divider pt-3">
                      In the validator queue — consensus judging runs hourly.
                    </p>
                  )}
                </div>
              </GlassCard>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

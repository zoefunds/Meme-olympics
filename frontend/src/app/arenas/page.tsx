"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { GlassCard, MonoLabel, StatusChip } from "@/components/ui";

/* Arenas — full browsable list of every competition, filterable by
   open/closed/finalized, so users can see what's live and what's over
   without hunting through the single "active" arena view. */

type Comp = {
  id: string;
  title: string;
  theme: string;
  status: string;
  startsAt: string;
  endsAt: string;
  submissionCount: number;
  prizeUsdcBaseUnits?: string;
  winners: Array<{ author: string; rank: number; reward_usdc: string }>;
};

const FILTERS = [
  { key: "open", label: "Open" },
  { key: "closed", label: "Judging" },
  { key: "finalized", label: "Finalized" },
  { key: "all", label: "All" },
] as const;

function usdcAmount(baseUnits?: string): string {
  if (!baseUnits) return "0";
  const usdc = Number(BigInt(baseUnits)) / 1e6;
  return usdc.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function timeLeft(endsAt: string, status: string): string {
  if (status !== "open") return "";
  const ms = new Date(endsAt).getTime() - Date.now();
  if (ms <= 0) return "closing…";
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 24) return `${Math.floor(h / 24)}d left`;
  if (h > 0) return `${h}h ${m}m left`;
  return `${m}m left`;
}

const STATUS_TONE: Record<string, "cyan" | "gold" | "muted"> = {
  open: "cyan",
  judging: "gold",
  finalized: "gold",
  created: "muted",
  cancelled: "muted",
};

export default function Arenas() {
  const [comps, setComps] = useState<Comp[]>([]);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("open");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = () =>
      api<{ competitions: Comp[] }>("/api/competitions")
        .then((r) => setComps(r.competitions))
        .catch(() => setComps([]))
        .finally(() => setLoading(false));
    load();
    // Arenas move between open/judging/finalized on their own schedule —
    // poll so status/counts stay live without a manual reload.
    const id = setInterval(load, 20000);
    return () => clearInterval(id);
  }, []);

  const filtered = useMemo(() => {
    if (filter === "all") return comps;
    if (filter === "closed") return comps.filter((c) => c.status === "judging");
    return comps.filter((c) => c.status === filter);
  }, [comps, filter]);

  const counts = useMemo(
    () => ({
      open: comps.filter((c) => c.status === "open").length,
      closed: comps.filter((c) => c.status === "judging").length,
      finalized: comps.filter((c) => c.status === "finalized").length,
      all: comps.length,
    }),
    [comps]
  );

  return (
    <main className="px-4 md:px-12 py-8 max-w-arena mx-auto space-y-10">
      <header className="flex flex-col md:flex-row justify-between md:items-end gap-6">
        <div>
          <MonoLabel className="text-cyan-dim tracking-[0.2em] block mb-2">
            Every arena, open and closed
          </MonoLabel>
          <h1 className="font-display font-bold text-4xl md:text-5xl">ARENAS</h1>
        </div>
        <Link
          href="/competitions/new"
          className="border border-white/20 bg-white/5 px-6 py-3 rounded-lg backdrop-blur-md font-display text-sm font-semibold uppercase tracking-widest hover:bg-white/10 transition-all w-fit"
        >
          + Host an Arena
        </Link>
      </header>

      {/* Filter tabs */}
      <div className="flex gap-2 bg-surface-high p-1 rounded-lg border border-white/5 w-fit overflow-x-auto max-w-full">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-5 py-2 rounded font-display text-xs font-semibold whitespace-nowrap uppercase transition-all ${
              filter === f.key
                ? "bg-gold-dim text-on-gold shadow-inner"
                : "text-on-variant hover:text-on-surface"
            }`}
          >
            {f.label} <span className="opacity-60">({counts[f.key]})</span>
          </button>
        ))}
      </div>

      {loading ? (
        <GlassCard className="p-12 text-center" scan>
          <p className="font-mono text-sm text-on-variant">Loading arenas…</p>
        </GlassCard>
      ) : filtered.length === 0 ? (
        <GlassCard className="p-12 text-center">
          <p className="font-mono text-sm text-on-variant">
            No {filter === "all" ? "" : filter} arenas right now —{" "}
            <Link href="/competitions/new" className="text-gold-soft">host one →</Link>
          </p>
        </GlassCard>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {filtered.map((c) => (
            <Link key={c.id} href={`/arenas/${c.id}`} className="block">
              <GlassCard className="p-6 h-full hover:border-cyan-soft/40 transition-colors cursor-pointer">
                <div className="flex justify-between items-start mb-4">
                  <StatusChip
                    label={c.status.toUpperCase()}
                    tone={STATUS_TONE[c.status] || "muted"}
                  />
                  {c.status === "open" && (
                    <span className="font-mono text-[10px] text-cyan-soft">
                      {timeLeft(c.endsAt, c.status)}
                    </span>
                  )}
                </div>
                <h3 className="font-display font-semibold text-xl mb-2 leading-tight">
                  {c.title}
                </h3>
                <p className="text-on-variant text-sm mb-6 line-clamp-2">{c.theme}</p>
                <div className="receipt-divider pt-4 flex justify-between items-center font-mono text-xs">
                  <span className="text-on-variant">{c.submissionCount} entries</span>
                  <span className="text-gold-dim">{usdcAmount(c.prizeUsdcBaseUnits)} USDC</span>
                </div>
              </GlassCard>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}

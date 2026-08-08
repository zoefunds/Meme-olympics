"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api, getUser } from "@/lib/api";
import { connectWallet, sendEscrowTxSequence, EscrowTxStep } from "@/lib/baseSepolia";
import { genlayerWrite } from "@/lib/genlayer";
import {
  GlassCard,
  MonoLabel,
  StatusChip,
  PrestigeButton,
  GhostButton,
  TerminalField,
} from "@/components/ui";

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
  prizeAtto: string; // legacy DB column name; stores USDC base units now
  createdByUserId?: string;
  onchainCreated: boolean;
  winners: Array<{
    author: string;
    rank: number;
    reward_usdc: string;
    score: number;
    submission_id: string;
    title: string;
    imageUrl: string;
    caption: string;
    criteria: Record<string, number>;
    plagiarismVerdict: string;
    evaluationSummary: string;
    username: string;
  }>;
};

const CRITERIA_LABELS: Record<string, string> = {
  originality: "Originality",
  humor: "Humor",
  relevance: "Relevance",
  timing: "Timing",
  irony: "Irony",
  cultural_awareness: "Cultural Awareness",
  crypto_native_understanding: "Crypto-Native",
  contextual_intelligence: "Contextual Intel",
  creativity: "Creativity",
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

function usdcAmount(baseUnits?: string): string {
  if (!baseUnits) return "0";
  const usdc = Number(BigInt(baseUnits)) / 1e6;
  return usdc.toLocaleString(undefined, { maximumFractionDigits: 4 });
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
  const [fundAmount, setFundAmount] = useState("");
  const [fundBusy, setFundBusy] = useState(false);
  const [fundStatus, setFundStatus] = useState("");
  const [resyncBusy, setResyncBusy] = useState(false);
  const [resyncStatus, setResyncStatus] = useState("");
  const countdown = useCountdown(comp?.endsAt, comp?.status === "open");

  function load() {
    if (!params?.id) return;
    api<Comp>(`/api/competitions/${params.id}`)
      .then(setComp)
      .catch((e) => setError((e as Error).message));
    api<{ leaderboard: unknown[] }>(`/api/competitions/${params.id}/leaderboard`)
      .then((r) => setSubCount(r.leaderboard.length))
      .catch(() => undefined);
  }

  useEffect(() => {
    if (!params?.id) return;
    load();
    const id = setInterval(load, 20000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params?.id]);

  // Re-runs the *-confirm sync against whatever the chain actually shows
  // right now. Safe to press any time — both routes re-read GenLayer/the
  // escrow contract server-side rather than trusting anything client-sent,
  // so this can't desync state further, only fix it. Exists because a
  // wallet-signed write can land on-chain while its immediate confirm call
  // gets interrupted (closed tab, timed-out prompt, flaky network) and the
  // DB never finds out.
  async function resync() {
    if (!comp) return;
    setResyncBusy(true);
    setResyncStatus("");
    try {
      setResyncStatus("Checking on-chain status…");
      await api(`/api/competitions/${comp.id}/onchain-confirm`, { method: "POST" }).catch(() => undefined);
      setResyncStatus("Checking prize pool…");
      await api(`/api/competitions/${comp.id}/fund-confirm`, { method: "POST" }).catch(() => undefined);
      setResyncStatus("✓ Synced with chain.");
      load();
    } catch (err) {
      setResyncStatus((err as Error).message);
    } finally {
      setResyncBusy(false);
    }
  }

  async function fundArena(e: React.FormEvent) {
    e.preventDefault();
    if (!comp) return;
    const amountUsdc = Number(fundAmount);
    if (!(amountUsdc > 0)) return;
    setFundBusy(true);
    setFundStatus("");
    try {
      setFundStatus("Connecting wallet…");
      const address = await connectWallet({ switchChain: false });

      setFundStatus("Confirm FUND ARENA in your wallet (GenLayer)…");
      const addedUsdcUnits = Math.round(amountUsdc * 1e6);
      await genlayerWrite(address, "fund_competition", [comp.id, addedUsdcUnits]);

      setFundStatus("Confirming with the server…");
      await api(`/api/competitions/${comp.id}/fund-confirm`, { method: "POST" });

      setFundStatus("Fetching deposit transactions…");
      const { steps } = await api<{ steps: EscrowTxStep[] }>(
        `/api/competitions/${comp.id}/escrow-fund-calldata?amountUsdc=${amountUsdc}`
      );
      setFundStatus("Confirm the approve + deposit transactions in your wallet (Base Sepolia)…");
      await connectWallet(); // ensures Base Sepolia is the active chain
      await sendEscrowTxSequence(steps);

      setFundStatus(`✓ Added ${amountUsdc} USDC to the prize pool.`);
      setFundAmount("");
      load();
    } catch (err) {
      setFundStatus((err as Error).message);
    } finally {
      setFundBusy(false);
    }
  }

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
              <MonoLabel>Prize Pool (USDC, Base Sepolia)</MonoLabel>
              <p className="font-display font-bold text-gold text-3xl">{usdcAmount(comp.prizeAtto)} USDC</p>
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

      {getUser()?.id === comp.createdByUserId && ["open", "judging"].includes(comp.status) && (
        <GlassCard className="p-6">
          <MonoLabel className="block mb-3">Add to the prize pool</MonoLabel>
          <p className="text-on-variant text-xs mb-4">
            Only you, as this arena&apos;s creator, can top up its USDC prize
            pool. You&apos;ll be asked to confirm on GenLayer, then approve +
            deposit the USDC on Base Sepolia.
          </p>
          <form onSubmit={fundArena} className="flex items-end gap-3">
            <div className="flex-1 max-w-xs">
              <TerminalField
                label="Amount (USDC)"
                type="number"
                value={fundAmount}
                onChange={(e) => setFundAmount(e.target.value)}
                placeholder="5"
              />
            </div>
            <PrestigeButton type="submit" disabled={fundBusy || !fundAmount}>
              {fundBusy ? "FUNDING…" : "FUND ARENA"}
            </PrestigeButton>
          </form>
          {fundStatus && (
            <p className="font-mono text-xs text-cyan-soft mt-3">{fundStatus}</p>
          )}
        </GlassCard>
      )}

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

      {getUser()?.id === comp.createdByUserId && (
        <div className="flex flex-col items-start gap-2">
          <GhostButton onClick={resync} disabled={resyncBusy}>
            {resyncBusy ? "SYNCING…" : "↻ RESYNC FROM CHAIN"}
          </GhostButton>
          <p className="font-mono text-[10px] text-on-variant">
            If a wallet transaction succeeded but this page still shows
            &quot;pending&quot; or the wrong prize amount, press this — it
            re-checks GenLayer and the escrow contract directly. Safe to
            press any time.
          </p>
          {resyncStatus && (
            <p className="font-mono text-xs text-cyan-soft">{resyncStatus}</p>
          )}
        </div>
      )}

      {comp.winners.length > 0 && (
        <section>
          <h2 className="font-display font-semibold text-2xl mb-4 uppercase">Winners</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {comp.winners.map((w) => (
              <GlassCard key={w.rank} className="border-gold-dim/30 overflow-hidden">
                {w.imageUrl && (
                  <Link href={`/meme/${w.submission_id}`} className="block h-56 overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={w.imageUrl}
                      alt={w.title}
                      className="w-full h-full object-cover hover:scale-105 transition-transform"
                    />
                  </Link>
                )}
                <div className="p-5">
                  <div className="flex justify-between items-start gap-3">
                    <div>
                      <MonoLabel>Rank #{w.rank}</MonoLabel>
                      <p className="font-display font-semibold text-lg mt-1">
                        {w.title || "Untitled"}
                      </p>
                      <p className="font-mono text-xs text-cyan-soft mt-1">
                        by @{w.username}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-display font-bold text-gold text-xl">
                        {usdcAmount(w.reward_usdc)}
                        <span className="text-xs text-on-variant ml-1">USDC</span>
                      </p>
                      <p className="font-mono text-xs text-on-variant mt-1">
                        {w.score}/100
                      </p>
                    </div>
                  </div>

                  {w.evaluationSummary && (
                    <p className="text-on-variant text-sm mt-4 leading-relaxed">
                      &ldquo;{w.evaluationSummary}&rdquo;
                    </p>
                  )}

                  {Object.keys(w.criteria || {}).length > 0 && (
                    <div className="grid grid-cols-3 gap-2 mt-4 receipt-divider pt-4">
                      {Object.entries(w.criteria).map(([key, val]) => (
                        <div key={key} className="font-mono text-[10px]">
                          <span className="text-on-variant block truncate">
                            {CRITERIA_LABELS[key] || key}
                          </span>
                          <span className="text-cyan-soft">{val}/10</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="receipt-divider mt-4 pt-3 flex justify-between font-mono text-xs">
                    <span className="text-on-variant">
                      Plagiarism: {w.plagiarismVerdict || "—"}
                    </span>
                    <Link href={`/meme/${w.submission_id}`} className="text-gold-soft underline">
                      Full report →
                    </Link>
                  </div>
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

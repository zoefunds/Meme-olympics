"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api, getUser } from "@/lib/api";
import {
  GlassCard,
  MonoLabel,
  SegmentedBar,
  StatusChip,
  GhostButton,
  PrestigeButton,
} from "@/components/ui";

/* Consensus Report — click-through from any meme card. Shows the full
   validator verdict: 9-criteria breakdown, plagiarism assessment, AI judging
   summary and on-chain provenance. */

type Sub = {
  id: string;
  competitionId: string;
  title: string;
  caption: string;
  imageUrl: string;
  contextUrl: string;
  tags: string[];
  status: string;
  totalScore: number;
  criteria: Record<string, number>;
  plagiarismVerdict: string;
  plagiarismConfidence: number;
  evaluationSummary: string;
  onchainTxHash: string;
  createdAt: string;
  user?: { username: string };
};

const CRITERIA_ORDER = [
  "originality",
  "humor",
  "relevance",
  "timing",
  "irony",
  "cultural_awareness",
  "crypto_native_understanding",
  "contextual_intelligence",
  "creativity",
];

const WEIGHTS_BP: Record<string, number> = {
  originality: 1600, humor: 1600, relevance: 1200, timing: 900, irony: 800,
  cultural_awareness: 1000, crypto_native_understanding: 1400,
  contextual_intelligence: 700, creativity: 800,
};

const STATUS_TONE: Record<string, "cyan" | "gold" | "muted"> = {
  winner: "gold", evaluated: "cyan", onchain: "muted", pending: "muted",
  disqualified: "muted", failed: "muted",
};

export default function MemeDetail() {
  const params = useParams<{ id: string }>();
  const [sub, setSub] = useState<Sub | null>(null);
  const [error, setError] = useState("");
  const [showDispute, setShowDispute] = useState(false);
  const [dispute, setDispute] = useState({ reason: "", evidenceUrl: "" });
  const [disputeMsg, setDisputeMsg] = useState("");
  const [disputeBusy, setDisputeBusy] = useState(false);

  async function submitDispute(e: React.FormEvent) {
    e.preventDefault();
    setDisputeBusy(true);
    setDisputeMsg("");
    try {
      await api("/api/disputes", {
        method: "POST",
        body: JSON.stringify({
          submissionId: sub!.id,
          reason: dispute.reason,
          evidenceUrl: dispute.evidenceUrl,
        }),
      });
      setDisputeMsg(
        "Challenge filed. The contract will fetch your evidence on-chain and validators will rule on it."
      );
      setShowDispute(false);
    } catch (err) {
      setDisputeMsg((err as Error).message);
    } finally {
      setDisputeBusy(false);
    }
  }

  useEffect(() => {
    if (!params?.id) return;
    api<{ submission: Sub }>(`/api/submissions/${params.id}`)
      .then((r) => setSub(r.submission))
      .catch((e) => setError((e as Error).message));
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
  if (!sub) {
    return (
      <main className="px-4 md:px-12 py-16 max-w-2xl mx-auto">
        <GlassCard className="p-10 text-center" scan>
          <p className="font-mono text-sm text-on-variant">Loading consensus report…</p>
        </GlassCard>
      </main>
    );
  }

  const judged = ["evaluated", "winner", "disqualified"].includes(sub.status);

  return (
    <main className="px-4 md:px-12 py-8 max-w-5xl mx-auto space-y-8">
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <MonoLabel className="text-cyan-dim block mb-2">
            CONSENSUS REPORT // {sub.id.slice(-8).toUpperCase()}
          </MonoLabel>
          <h1 className="font-display font-bold text-3xl md:text-5xl text-cream">{sub.title}</h1>
          <p className="font-mono text-xs text-purple-soft mt-2">
            by @{sub.user?.username || "anon"} ·{" "}
            <Link href="/leaderboard" className="text-on-variant hover:text-white underline">
              {sub.competitionId}
            </Link>
          </p>
        </div>
        <StatusChip label={sub.status.toUpperCase()} tone={STATUS_TONE[sub.status] || "muted"} />
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Meme asset */}
        <GlassCard className="lg:col-span-2 self-start">
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={sub.imageUrl} alt={sub.title} className="w-full object-contain max-h-[420px] bg-black" />
            {!judged && <div className="scanline" />}
          </div>
          <div className="p-5 space-y-3">
            {sub.caption && <p className="text-on-variant text-sm leading-relaxed">{sub.caption}</p>}
            <div className="flex flex-wrap gap-2">
              {sub.tags.map((t) => (
                <span key={t} className="px-3 py-1 glass-panel text-cyan-soft font-mono text-[10px] rounded-full border-cyan-soft/30">
                  #{t.toUpperCase()}
                </span>
              ))}
            </div>
            {sub.contextUrl && (
              <p className="font-mono text-[11px] receipt-divider pt-3">
                <span className="text-on-variant">CONTEXT: </span>
                <a href={sub.contextUrl} className="text-cyan-soft break-all" target="_blank" rel="noreferrer">
                  {sub.contextUrl}
                </a>
              </p>
            )}
          </div>
        </GlassCard>

        {/* Consensus results */}
        <div className="lg:col-span-3 space-y-6">
          <GlassCard className={`p-8 ${sub.status === "winner" ? "border-gold/30 prestige-glow" : "border-cream/10"}`}>
            <div className="flex items-end justify-between mb-8">
              <div>
                <MonoLabel>Validator Consensus Score</MonoLabel>
                <div className="flex items-end gap-3 mt-1">
                  <span className={`font-display font-bold text-7xl leading-none ${sub.status === "winner" ? "text-gold" : "text-cream"}`}>
                    {judged ? sub.totalScore : "--"}
                  </span>
                  <span className="font-display text-2xl text-on-variant pb-1">/ 100</span>
                </div>
              </div>
              {judged && (
                <StatusChip
                  label={sub.status === "disqualified" ? "DISQUALIFIED" : "GENLAYER VALIDATED"}
                  tone={sub.status === "disqualified" ? "muted" : "cyan"}
                />
              )}
            </div>

            {judged ? (
              <div className="space-y-4">
                {CRITERIA_ORDER.map((c) => (
                  <div key={c}>
                    <div className="flex justify-between font-mono text-[11px] uppercase mb-1.5">
                      <span className="text-white">
                        {c.replace(/_/g, " ")}
                        <span className="text-on-variant/60 ml-2">({(WEIGHTS_BP[c] / 100).toFixed(0)}% weight)</span>
                      </span>
                      <span className="text-cyan-dim">{sub.criteria[c] ?? 0}/10</span>
                    </div>
                    <SegmentedBar percent={(sub.criteria[c] ?? 0) * 10} gold={(sub.criteria[c] ?? 0) >= 8} />
                  </div>
                ))}
              </div>
            ) : (
              <p className="font-mono text-xs text-on-variant">
                &gt; Awaiting validator consensus — judging sweeps run hourly.
                Leader scores first, then every validator independently
                re-judges before anything settles.
              </p>
            )}
          </GlassCard>

          {judged && (
            <GlassCard className="p-6 bg-black/40">
              <MonoLabel className="text-cyan-soft block mb-4">AI_JUDGING_SUMMARY</MonoLabel>
              <p className="font-mono text-xs leading-relaxed text-on-surface">
                &gt; {sub.evaluationSummary || "No summary recorded."}
              </p>
              <div className="receipt-divider mt-4 pt-4 grid grid-cols-2 gap-4 font-mono text-[11px]">
                <div>
                  <span className="text-on-variant block">ORIGINALITY VERDICT</span>
                  <span className={sub.plagiarismVerdict === "copied" ? "text-danger" : sub.plagiarismVerdict === "original" ? "text-gold-soft" : "text-cyan-soft"}>
                    {(sub.plagiarismVerdict || "n/a").toUpperCase()} ({sub.plagiarismConfidence}% confidence)
                  </span>
                </div>
                <div>
                  <span className="text-on-variant block">CONSENSUS MODEL</span>
                  <span>Leader + independent validator re-judging (±15 tolerance)</span>
                </div>
              </div>
            </GlassCard>
          )}

          {/* Challenge / dispute — evidence-based, resolved on-chain */}
          {["evaluated", "winner"].includes(sub.status) && (
            <GlassCard className="p-6 border-danger/20">
              {!showDispute ? (
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div>
                    <h3 className="font-display font-semibold text-lg">Think this meme is stolen or misjudged?</h3>
                    <p className="font-mono text-[11px] text-on-variant mt-1">
                      Challenges need a public evidence URL — validators fetch
                      it on-chain and rule. Words alone decide nothing.
                    </p>
                  </div>
                  <GhostButton
                    onClick={() =>
                      getUser() ? setShowDispute(true) : (window.location.href = "/login")
                    }
                    className="whitespace-nowrap border-danger/40 hover:bg-danger/10"
                  >
                    ⚔ Challenge This Meme
                  </GhostButton>
                </div>
              ) : (
                <form onSubmit={submitDispute} className="space-y-5">
                  <MonoLabel className="text-danger">DISPUTE PROTOCOL // EVIDENCE REQUIRED</MonoLabel>
                  <div className="flex flex-col gap-2">
                    <MonoLabel>Your claim (min 10 chars)</MonoLabel>
                    <textarea
                      className="terminal-input font-body resize-none"
                      rows={3}
                      minLength={10}
                      maxLength={1000}
                      required
                      placeholder="e.g. This exact meme was posted on r/cryptocurrency two weeks before this competition…"
                      value={dispute.reason}
                      onChange={(e) => setDispute({ ...dispute, reason: e.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <MonoLabel>Public evidence URL (fetched on-chain by validators)</MonoLabel>
                    <input
                      className="terminal-input font-mono text-sm"
                      type="url"
                      required
                      placeholder="https://www.reddit.com/r/cryptocurrency/comments/…"
                      value={dispute.evidenceUrl}
                      onChange={(e) => setDispute({ ...dispute, evidenceUrl: e.target.value })}
                    />
                  </div>
                  <div className="flex gap-3">
                    <PrestigeButton type="submit" disabled={disputeBusy}>
                      {disputeBusy ? "FILING ON-CHAIN…" : "File Challenge"}
                    </PrestigeButton>
                    <GhostButton type="button" onClick={() => setShowDispute(false)}>
                      Cancel
                    </GhostButton>
                  </div>
                </form>
              )}
              {disputeMsg && (
                <p className="font-mono text-xs mt-4 text-cyan-soft">{disputeMsg}</p>
              )}
            </GlassCard>
          )}

          {sub.onchainTxHash && (
            <GlassCard className="p-5">
              <MonoLabel>On-chain registration tx</MonoLabel>
              <p className="font-mono text-[11px] text-cyan-soft break-all mt-1">{sub.onchainTxHash}</p>
            </GlassCard>
          )}
        </div>
      </div>
    </main>
  );
}

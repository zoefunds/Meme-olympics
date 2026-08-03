"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { GlassCard, MonoLabel, StatusChip } from "@/components/ui";

/* Disputes — public transparency page. Anyone can see every challenge
   filed against a judged meme and how it was resolved; nothing here is
   ruled on from a claim alone, so this list doubles as a receipt that the
   evidence-fetching + validator process is real. */

type Dispute = {
  id: string;
  submissionId: string;
  reason: string;
  evidenceUrl: string;
  status: string;
  verdict: string;
  onchainOpened: boolean;
  createdAt: string;
  resolvedAt: string | null;
  submission: { title: string; imageUrl: string };
  username: string;
};

const STATUS_TONE: Record<string, "cyan" | "gold" | "muted"> = {
  open: "cyan",
  upheld: "gold",
  rejected: "muted",
};

const STATUS_COPY: Record<string, string> = {
  open: "Awaiting validator ruling",
  upheld: "Upheld — submission disqualified",
  rejected: "Rejected — original verdict stands",
};

export default function DisputesPage() {
  const [disputes, setDisputes] = useState<Dispute[] | null>(null);

  useEffect(() => {
    const load = () =>
      api<{ disputes: Dispute[] }>("/api/disputes")
        .then((r) => setDisputes(r.disputes))
        .catch(() => setDisputes([]));
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, []);

  return (
    <main className="px-4 md:px-12 py-8 max-w-arena mx-auto space-y-8">
      <header>
        <MonoLabel className="text-purple-soft tracking-[0.2em] block mb-2">
          Evidence-Based &middot; On-Chain Ruled
        </MonoLabel>
        <h1 className="font-display font-bold text-4xl md:text-5xl">DISPUTES</h1>
        <p className="text-on-variant max-w-2xl mt-4">
          Every challenge filed against a judged meme, and how it was ruled.
          The contract fetches the submitted evidence URL on-chain itself —
          nothing here is ever resolved from a claim alone.
        </p>
      </header>

      {!disputes ? (
        <GlassCard className="p-12 text-center" scan>
          <p className="font-mono text-sm text-on-variant">Loading…</p>
        </GlassCard>
      ) : disputes.length === 0 ? (
        <GlassCard className="p-12 text-center">
          <p className="font-mono text-sm text-on-variant">
            No disputes filed yet.
          </p>
        </GlassCard>
      ) : (
        <div className="space-y-4">
          {disputes.map((d) => (
            <GlassCard key={d.id} className="p-6">
              <div className="flex flex-col md:flex-row gap-4 md:items-center md:justify-between">
                <div className="flex items-center gap-4 min-w-0">
                  {d.submission.imageUrl && (
                    <Link href={`/meme/${d.submissionId}`} className="shrink-0">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={d.submission.imageUrl}
                        alt={d.submission.title}
                        className="w-16 h-16 object-cover rounded-lg border border-white/10"
                      />
                    </Link>
                  )}
                  <div className="min-w-0">
                    <p className="font-display font-semibold truncate">
                      {d.submission.title || "Untitled meme"}
                    </p>
                    <p className="font-mono text-xs text-cyan-soft mt-1">
                      filed by @{d.username}
                    </p>
                  </div>
                </div>
                <div className="flex flex-col items-start md:items-end gap-2 shrink-0">
                  <StatusChip
                    label={(STATUS_COPY[d.status] || d.status).toUpperCase()}
                    tone={STATUS_TONE[d.status] || "muted"}
                  />
                  <span className="font-mono text-[10px] text-on-variant">
                    {new Date(d.createdAt).toLocaleString(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </span>
                </div>
              </div>
              <div className="receipt-divider mt-4 pt-4">
                <p className="text-on-variant text-sm">{d.reason}</p>
                <a
                  href={d.evidenceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-xs text-gold-soft underline mt-2 inline-block break-all"
                >
                  Evidence →
                </a>
                {d.verdict && (
                  <p className="font-mono text-xs text-on-variant mt-3 italic">
                    &ldquo;{d.verdict}&rdquo;
                  </p>
                )}
              </div>
            </GlassCard>
          ))}
        </div>
      )}
    </main>
  );
}

"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, getUser } from "@/lib/api";
import { connectWallet, sendEscrowTxSequence } from "@/lib/baseSepolia";
import { GlassCard, MonoLabel, StatusChip, PrestigeButton } from "@/components/ui";

type Rewards = {
  walletAddress: string;
  pendingRelayUsdc: number;
  totalClaimableUsdc: number;
  escrow: { chain: string; address: string | null; usdcAddress: string };
  wins: Array<{
    submissionId: string;
    title: string;
    imageUrl: string;
    score: number;
    competition: { id: string; title: string };
    relayed: boolean;
    claimableUsdcBaseUnits: string;
  }>;
};

export default function RewardsPage() {
  const router = useRouter();
  const [data, setData] = useState<Rewards | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [claimMsg, setClaimMsg] = useState("");

  function load() {
    api<Rewards>("/api/rewards/me").then(setData).catch(() => undefined);
  }

  useEffect(() => {
    if (!getUser()) return router.push("/login");
    load();
    // Wins/claimable balance change as arenas finalize and relay to Base
    // Sepolia in the background — poll so this updates without a reload.
    const id = setInterval(load, 20000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function claim() {
    setClaiming(true);
    setClaimMsg("");
    try {
      setClaimMsg("Connecting wallet…");
      await connectWallet();
      setClaimMsg("Fetching claim transaction…");
      const { to, data: calldata, value } = await api<{
        to: string;
        data: string;
        value: string;
      }>("/api/rewards/claim-calldata", { method: "POST" });
      setClaimMsg("Confirm the claim transaction in your wallet…");
      await sendEscrowTxSequence([{ to, data: calldata, value }]);
      setClaimMsg("✓ Claim submitted — USDC will land in your wallet on Base Sepolia shortly.");
      load();
    } catch (err) {
      setClaimMsg((err as Error).message);
    } finally {
      setClaiming(false);
    }
  }

  return (
    <main className="px-4 md:px-12 py-8 max-w-arena mx-auto space-y-10">
      <header>
        <MonoLabel className="text-gold-dim tracking-[0.2em] block mb-2">Prize Vault</MonoLabel>
        <h1 className="font-display font-bold text-4xl md:text-5xl">REWARDS</h1>
      </header>

      <GlassCard className="p-8 md:p-12 border-gold/20 prestige-glow" scan>
        <div className="flex flex-col md:flex-row justify-between gap-8 items-start md:items-center">
          <div>
            <MonoLabel>Claimable USDC (Base Sepolia)</MonoLabel>
            <div className="font-display font-bold text-6xl text-gold mt-2">
              {data ? data.totalClaimableUsdc.toLocaleString() : "—"}
              <span className="text-2xl text-on-variant ml-2">USDC</span>
            </div>
            <p className="font-mono text-[11px] text-on-variant mt-3 break-all">
              Escrowed by MemeOlympicsEscrow for {data?.walletAddress || "your wallet"} —
              GenLayer judged it, this contract pays it.
            </p>
            {data && data.pendingRelayUsdc > 0 && (
              <p className="font-mono text-[11px] text-cyan-soft mt-2">
                {data.pendingRelayUsdc.toLocaleString()} USDC won but not yet relayed
                to Base Sepolia — check back shortly.
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-3">
            <StatusChip label="GenLayer judged · Base Sepolia pays" tone="gold" />
            <PrestigeButton
              disabled={claiming || !data || data.totalClaimableUsdc <= 0}
              onClick={claim}
            >
              {claiming ? "CLAIMING…" : "Claim USDC"}
            </PrestigeButton>
          </div>
        </div>
        {claimMsg && (
          <p className="font-mono text-xs text-cyan-soft mt-6 receipt-divider pt-4">
            {claimMsg}
          </p>
        )}
      </GlassCard>

      <section>
        <h2 className="font-display font-semibold text-2xl mb-6 uppercase">Winning Entries</h2>
        {!data || data.wins.length === 0 ? (
          <GlassCard className="p-12 text-center">
            <p className="font-mono text-sm text-on-variant">
              No podium finishes yet. The validators await your best work —{" "}
              <Link href="/submit" className="text-gold-soft">submit a meme →</Link>
            </p>
          </GlassCard>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {data.wins.map((w) => (
              <GlassCard key={w.submissionId} className="border-gold-dim/30">
                <div className="h-48 overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={w.imageUrl} alt={w.title} className="w-full h-full object-cover" />
                </div>
                <div className="p-5">
                  <p className="font-display font-semibold text-lg">🥇 {w.title}</p>
                  <div className="receipt-divider mt-3 pt-3 flex justify-between font-mono text-xs">
                    <span className="text-on-variant">{w.competition.title}</span>
                    <span className="text-gold-dim">{w.score}/100</span>
                  </div>
                </div>
              </GlassCard>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

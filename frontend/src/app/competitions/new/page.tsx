"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, getUser } from "@/lib/api";
import { connectWallet, sendEscrowTxSequence, EscrowTxStep } from "@/lib/baseSepolia";
import { genlayerWrite } from "@/lib/genlayer";
import { GlassCard, MonoLabel, PrestigeButton, TerminalField } from "@/components/ui";

export default function NewCompetition() {
  const router = useRouter();
  const [form, setForm] = useState({ title: "", theme: "", endsAt: "", prizeUsdc: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (!getUser()) router.push("/login");
  }, [router]);

  async function depositPrize(address: string, competitionId: string, amountUsdc: number) {
    setStatus("Fetching deposit transactions…");
    const { steps } = await api<{ steps: EscrowTxStep[] }>(
      `/api/competitions/${competitionId}/escrow-fund-calldata?amountUsdc=${amountUsdc}`
    );
    setStatus("Confirm the approve + deposit transactions in your wallet (Base Sepolia)…");
    await connectWallet(); // ensures Base Sepolia is the active chain
    await sendEscrowTxSequence(steps);
    setStatus("✓ Prize pool funded on Base Sepolia.");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const prizeUsdc = form.prizeUsdc ? Number(form.prizeUsdc) : 0;
      const { competition, genlayer } = await api<{
        competition: { id: string };
        genlayer: { functionArgs: unknown[] };
      }>("/api/competitions", {
        method: "POST",
        body: JSON.stringify({
          title: form.title,
          theme: form.theme,
          endsAt: new Date(form.endsAt).toISOString(),
          prizeUsdc,
        }),
      });

      setStatus("Connecting wallet…");
      const address = await connectWallet({ switchChain: false });

      setStatus("Confirm CREATE ARENA in your wallet (GenLayer)…");
      await genlayerWrite(address, "create_competition", genlayer.functionArgs);
      setStatus("Confirm OPEN ARENA in your wallet (GenLayer)…");
      await genlayerWrite(address, "open_competition", [competition.id]);

      setStatus("Confirming with the server…");
      await api(`/api/competitions/${competition.id}/onchain-confirm`, { method: "POST" });

      if (prizeUsdc > 0) {
        try {
          await depositPrize(address, competition.id, prizeUsdc);
        } catch (depositErr) {
          // The arena itself is created and judgeable either way — a failed
          // deposit just means it's prestige-only until someone funds it
          // (this page, or the arena page's "fund" action, can retry).
          setStatus(
            `Arena created, but the USDC deposit failed: ${
              (depositErr as Error).message
            }. You can fund it later from the arena page.`
          );
          setBusy(false);
          return;
        }
      }
      router.push(`/arenas/${competition.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="px-4 md:px-12 py-12 max-w-2xl mx-auto">
      <header className="mb-10">
        <MonoLabel className="text-gold-dim tracking-[0.2em] block mb-2">
          Open to all competitors
        </MonoLabel>
        <h1 className="font-display font-bold text-4xl md:text-5xl text-cream">
          HOST AN ARENA
        </h1>
        <p className="text-on-variant mt-4">
          Anyone can create a meme competition. You set the theme, deadline,
          and — optionally — fund a real USDC prize pool on Base Sepolia.
          GenLayer validator consensus does the judging; winners self-claim
          their USDC directly from the escrow contract with their own wallet.
        </p>
      </header>
      <GlassCard className="p-8 md:p-12" scan>
        <form onSubmit={submit} className="space-y-8">
          <TerminalField
            label="Competition title"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="ETF Season Meltdown Memes"
            maxLength={120}
            required
          />
          <div className="flex flex-col gap-2">
            <MonoLabel>Theme / brief for the AI judges</MonoLabel>
            <textarea
              className="terminal-input font-body resize-none"
              rows={3}
              maxLength={600}
              placeholder="What should memes be about? The judges score Relevance & Timing against this brief."
              value={form.theme}
              onChange={(e) => setForm({ ...form, theme: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-2">
            <MonoLabel>Submissions close</MonoLabel>
            <input
              type="datetime-local"
              className="terminal-input font-mono text-sm [color-scheme:dark]"
              value={form.endsAt}
              onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <MonoLabel>Prize pool — USDC on Base Sepolia (optional)</MonoLabel>
            <input
              type="number"
              min="0"
              step="0.01"
              className="terminal-input font-mono text-sm"
              placeholder="0 (prestige-only — no monetary prize)"
              value={form.prizeUsdc}
              onChange={(e) => setForm({ ...form, prizeUsdc: e.target.value })}
            />
            <p className="font-mono text-[10px] text-on-variant">
              After creating the arena, you&apos;ll be asked to approve and
              deposit this amount of USDC from your own wallet (MetaMask etc.)
              on Base Sepolia — a separate chain from GenLayer, where judging
              happens. Leave blank/0 for a ranking-only arena. Anyone
              (including you) can add more later.
            </p>
          </div>
          {error && <p className="text-danger font-mono text-xs">{error}</p>}
          {status && (
            <p className="text-cyan-soft font-mono text-xs">{status}</p>
          )}
          <PrestigeButton type="submit" disabled={busy} className="w-full py-4">
            {busy ? "OPENING ARENA…" : "OPEN THE ARENA"}
          </PrestigeButton>
          <p className="font-mono text-[10px] text-on-variant">
            Anti-spam: 3 arenas per day per account. Judging settles on-chain
            via the MemeOlympics GenLayer contract; prize money settles via
            MemeOlympicsEscrow on Base Sepolia.
          </p>
        </form>
      </GlassCard>
    </main>
  );
}

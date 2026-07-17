"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, getUser } from "@/lib/api";
import { GlassCard, MonoLabel, PrestigeButton, TerminalField } from "@/components/ui";

export default function NewCompetition() {
  const router = useRouter();
  const [form, setForm] = useState({ title: "", theme: "", endsAt: "", prizeGen: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!getUser()) router.push("/login");
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/competitions", {
        method: "POST",
        body: JSON.stringify({
          title: form.title,
          theme: form.theme,
          endsAt: new Date(form.endsAt).toISOString(),
          prizeGen: form.prizeGen ? Number(form.prizeGen) : 0,
        }),
      });
      router.push("/arena");
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
          and — optionally — fund a real GEN prize pool straight from your
          own wallet. GenLayer validator consensus does the judging. Winners
          split the pool 50/30/20 and claim their GEN directly from the
          contract.
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
            <MonoLabel>Prize pool — GEN (optional, sent from your wallet)</MonoLabel>
            <input
              type="number"
              min="0"
              step="0.01"
              className="terminal-input font-mono text-sm"
              placeholder="0 (prestige-only — no monetary prize)"
              value={form.prizeGen}
              onChange={(e) => setForm({ ...form, prizeGen: e.target.value })}
            />
            <p className="font-mono text-[10px] text-on-variant">
              This amount is sent as a real GEN transaction from your custodial
              wallet and escrowed by the contract. Leave blank/0 for a
              ranking-only arena. Anyone (including you) can add more later.
            </p>
          </div>
          {error && <p className="text-danger font-mono text-xs">{error}</p>}
          <PrestigeButton type="submit" disabled={busy} className="w-full py-4">
            {busy ? "OPENING ARENA…" : "OPEN THE ARENA"}
          </PrestigeButton>
          <p className="font-mono text-[10px] text-on-variant">
            Anti-spam: 3 arenas per day per account. Competitions settle
            on-chain via the MemeOlympics intelligent contract.
          </p>
        </form>
      </GlassCard>
    </main>
  );
}

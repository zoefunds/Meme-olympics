"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { GlassCard, PrestigeButton, TerminalField, MonoLabel } from "@/components/ui";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api<{ message: string }>("/api/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setMessage(res.message);
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="px-4 md:px-12 py-16 max-w-md mx-auto">
      <GlassCard className="p-8 md:p-10">
        <MonoLabel className="text-cyan-dim">RECOVERY PROTOCOL</MonoLabel>
        <h1 className="font-display font-bold text-3xl mt-2 mb-8 text-cream">RESET PASSWORD</h1>
        {message ? (
          <p className="font-mono text-sm text-cyan-soft">{message}</p>
        ) : (
          <form onSubmit={submit} className="space-y-6">
            <TerminalField label="Account email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@arena.gg" />
            <PrestigeButton type="submit" disabled={busy} className="w-full">
              {busy ? "TRANSMITTING…" : "SEND RESET LINK"}
            </PrestigeButton>
          </form>
        )}
      </GlassCard>
    </main>
  );
}

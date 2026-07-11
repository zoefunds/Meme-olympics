"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, setSession } from "@/lib/api";
import { GlassCard, PrestigeButton, TerminalField, MonoLabel, StatusChip } from "@/components/ui";

export default function Register() {
  const router = useRouter();
  const [form, setForm] = useState({ email: "", username: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await api<{ token: string; user: unknown }>("/api/auth/register", {
        method: "POST",
        body: JSON.stringify(form),
      });
      setSession(res.token, res.user);
      router.push("/dashboard");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="px-4 md:px-12 py-16 max-w-md mx-auto">
      <GlassCard className="p-8 md:p-10" scan>
        <MonoLabel className="text-cyan-dim">ARENA GATE // NEW COMPETITOR</MonoLabel>
        <h1 className="font-display font-bold text-3xl mt-2 mb-4 text-cream">JOIN THE OLYMPICS</h1>
        <div className="mb-8">
          <StatusChip label="Wallet auto-created & permanently linked" tone="gold" />
        </div>
        <form onSubmit={submit} className="space-y-6">
          <TerminalField label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required placeholder="you@arena.gg" />
          <TerminalField label="Username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required placeholder="meme_gladiator" />
          <TerminalField label="Password (min 8 chars)" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required placeholder="••••••••" />
          {error && <p className="text-danger text-sm font-mono">{error}</p>}
          <PrestigeButton type="submit" disabled={busy} className="w-full">
            {busy ? "FORGING WALLET…" : "CREATE ACCOUNT"}
          </PrestigeButton>
        </form>
        <p className="mt-6 font-mono text-xs text-on-variant">
          Your GenLayer wallet survives device changes and reinstalls. Export
          your private key anytime from Settings.
        </p>
        <div className="mt-4 font-mono text-xs">
          <Link href="/login" className="text-cyan-soft hover:text-cyan">Already competing? Sign in →</Link>
        </div>
      </GlassCard>
    </main>
  );
}

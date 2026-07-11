"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, setSession } from "@/lib/api";
import { GlassCard, PrestigeButton, TerminalField, MonoLabel } from "@/components/ui";

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await api<{ token: string; user: unknown }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
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
        <MonoLabel className="text-cyan-dim">ARENA GATE // AUTH</MonoLabel>
        <h1 className="font-display font-bold text-3xl mt-2 mb-8 text-cream">SIGN IN</h1>
        <form onSubmit={submit} className="space-y-6">
          <TerminalField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@arena.gg" />
          <TerminalField label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="••••••••" />
          {error && <p className="text-danger text-sm font-mono">{error}</p>}
          <PrestigeButton type="submit" disabled={busy} className="w-full">
            {busy ? "AUTHENTICATING…" : "ENTER"}
          </PrestigeButton>
        </form>
        <div className="mt-6 flex justify-between font-mono text-xs">
          <Link href="/forgot-password" className="text-cyan-soft hover:text-cyan">Forgot password?</Link>
          <Link href="/register" className="text-on-variant hover:text-white">Create account →</Link>
        </div>
      </GlassCard>
    </main>
  );
}

"use client";
import { Suspense, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { GlassCard, PrestigeButton, TerminalField, MonoLabel } from "@/components/ui";

function ResetForm() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token") || "";
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, password }),
      });
      setMessage("Password updated. Redirecting to sign in…");
      setTimeout(() => router.push("/login"), 1500);
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <GlassCard className="p-8 md:p-10">
      <MonoLabel className="text-cyan-dim">RECOVERY PROTOCOL // PHASE 2</MonoLabel>
      <h1 className="font-display font-bold text-3xl mt-2 mb-8 text-cream">NEW PASSWORD</h1>
      <form onSubmit={submit} className="space-y-6">
        <TerminalField label="New password (min 8 chars)" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {message && <p className="font-mono text-sm text-cyan-soft">{message}</p>}
        <PrestigeButton type="submit" disabled={busy || !token} className="w-full">
          {busy ? "UPDATING…" : "SET PASSWORD"}
        </PrestigeButton>
        {!token && <p className="text-danger font-mono text-xs">Missing reset token — use the link from your email.</p>}
      </form>
    </GlassCard>
  );
}

export default function ResetPassword() {
  return (
    <main className="px-4 md:px-12 py-16 max-w-md mx-auto">
      <Suspense>
        <ResetForm />
      </Suspense>
    </main>
  );
}

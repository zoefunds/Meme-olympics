"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, getUser } from "@/lib/api";
import { GlassCard, MonoLabel, PrestigeButton, GhostButton, TerminalField } from "@/components/ui";

type Balances = { walletBalance: number; onchainBalance: number };

export default function Settings() {
  const router = useRouter();
  const user = typeof window !== "undefined" ? getUser() : null;
  const [password, setPassword] = useState("");
  const [exported, setExported] = useState<{ walletAddress: string; privateKey: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [balances, setBalances] = useState<Balances | null>(null);

  useEffect(() => {
    if (!getUser()) router.push("/login");
  }, [router]);

  useEffect(() => {
    if (!getUser()) return;
    const load = () =>
      api<Balances>("/api/rewards/me").then(setBalances).catch(() => undefined);
    load();
    // Real-time-ish: poll so a claim, a new stake, or a received transfer
    // shows up here without a manual reload.
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, []);

  async function exportKey(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await api<{ walletAddress: string; privateKey: string }>(
        "/api/auth/export-key",
        { method: "POST", body: JSON.stringify({ password }) }
      );
      setExported(res);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="px-4 md:px-12 py-8 max-w-2xl mx-auto space-y-8">
      <header>
        <MonoLabel className="text-cyan-dim block mb-2">SYSTEM CONFIG</MonoLabel>
        <h1 className="font-display font-bold text-4xl">SETTINGS</h1>
      </header>

      <GlassCard className="p-8">
        <h2 className="font-display font-semibold text-xl mb-4">Account</h2>
        <div className="space-y-3 font-mono text-sm">
          <div className="flex justify-between border-b border-white/5 pb-2">
            <span className="text-on-variant">USERNAME</span>
            <span>@{user?.username}</span>
          </div>
          <div className="flex justify-between border-b border-white/5 pb-2">
            <span className="text-on-variant">EMAIL</span>
            <span>{user?.email}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-on-variant">WALLET</span>
            <span className="break-all text-cyan-soft text-xs">{user?.walletAddress}</span>
          </div>
        </div>
      </GlassCard>

      <GlassCard className="p-8" scan>
        <h2 className="font-display font-semibold text-xl mb-4">GEN Balance</h2>
        {balances ? (
          <div className="grid grid-cols-2 gap-4 font-mono">
            <div className="bg-black/30 rounded-lg p-4 border border-white/5">
              <MonoLabel className="text-on-variant text-[10px] block mb-1">
                WALLET (spendable)
              </MonoLabel>
              <p className="font-display font-bold text-cyan-soft text-2xl">
                {balances.walletBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </p>
            </div>
            <div className="bg-black/30 rounded-lg p-4 border border-white/5">
              <MonoLabel className="text-on-variant text-[10px] block mb-1">
                CLAIMABLE (escrow)
              </MonoLabel>
              <p className="font-display font-bold text-gold-soft text-2xl">
                {balances.onchainBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </p>
            </div>
          </div>
        ) : (
          <p className="font-mono text-sm text-on-variant">Loading balance…</p>
        )}
        <p className="text-on-variant text-xs mt-4">
          Updates automatically every 10 seconds. Claimable GEN sits in the
          contract's escrow until you claim it from the{" "}
          <a href="/rewards" className="text-gold-soft underline">Rewards page</a>.
        </p>
      </GlassCard>

      <GlassCard className="p-8 border-gold/20" scan>
        <h2 className="font-display font-semibold text-xl mb-2 text-gold-soft">
          Export Private Key
        </h2>
        <p className="text-on-variant text-sm mb-6">
          Your wallet was created at registration and is permanently linked to
          your account — it survives device changes and reinstalls. Exporting
          the key lets you use it in MetaMask or any EVM wallet.{" "}
          <span className="text-danger">Never share it with anyone.</span>
        </p>
        {exported ? (
          <div className="space-y-4">
            <div className="bg-black/60 p-4 rounded font-mono text-xs break-all border border-gold/20">
              {revealed ? exported.privateKey : "•".repeat(66)}
            </div>
            <div className="flex gap-3">
              <GhostButton onClick={() => setRevealed(!revealed)}>
                {revealed ? "Hide" : "Reveal"}
              </GhostButton>
              <GhostButton
                onClick={() => navigator.clipboard.writeText(exported.privateKey)}
              >
                Copy
              </GhostButton>
            </div>
          </div>
        ) : (
          <form onSubmit={exportKey} className="space-y-6">
            <TerminalField
              label="Confirm your password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            {error && <p className="text-danger font-mono text-xs">{error}</p>}
            <PrestigeButton type="submit" disabled={busy}>
              {busy ? "DECRYPTING…" : "Export Key"}
            </PrestigeButton>
          </form>
        )}
      </GlassCard>
    </main>
  );
}

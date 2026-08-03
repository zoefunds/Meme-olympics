"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, getUser, getToken, setSession, shortAddress } from "@/lib/api";
import { GlassCard, MonoLabel, PrestigeButton, TerminalField } from "@/components/ui";

type Balances = { walletUsdc: number; pendingRelayUsdc: number; totalClaimableUsdc: number };

export default function Settings() {
  const router = useRouter();
  const [user, setUser] = useState(typeof window !== "undefined" ? getUser() : null);
  const [balances, setBalances] = useState<Balances | null>(null);
  const [username, setUsername] = useState(user?.username || "");
  const [usernameBusy, setUsernameBusy] = useState(false);
  const [usernameMsg, setUsernameMsg] = useState("");

  useEffect(() => {
    if (!getUser()) router.push("/login");
  }, [router]);

  async function saveUsername(e: React.FormEvent) {
    e.preventDefault();
    setUsernameBusy(true);
    setUsernameMsg("");
    try {
      const { user: updated } = await api<{ user: NonNullable<ReturnType<typeof getUser>> }>(
        "/api/auth/me",
        { method: "PATCH", body: JSON.stringify({ username }) }
      );
      setSession(getToken()!, updated);
      setUser(updated);
      setUsernameMsg("✓ Saved.");
    } catch (err) {
      setUsernameMsg((err as Error).message);
    } finally {
      setUsernameBusy(false);
    }
  }

  useEffect(() => {
    if (!getUser()) return;
    const load = () =>
      api<Balances>("/api/rewards/me").then(setBalances).catch(() => undefined);
    load();
    // Real-time-ish: poll so a claim or a newly-relayed win shows up here
    // without a manual reload.
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, []);

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
            <span className="text-on-variant">IDENTITY</span>
            <span>
              {user?.username ? `@${user.username}` : user ? shortAddress(user.authAddress) : ""}
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-on-variant">CONNECTED WALLET</span>
            <span className="break-all text-cream text-xs">{user?.authAddress}</span>
          </div>
        </div>
        <p className="text-on-variant text-xs mt-4">
          This wallet signs everything — logging in, hosting/submitting/disputing
          on GenLayer, and funding/claiming USDC on Base Sepolia. There's no
          separate key anywhere in this app.
        </p>

        <form onSubmit={saveUsername} className="mt-6 pt-6 receipt-divider flex items-end gap-3">
          <div className="flex-1">
            <TerminalField
              label="Display name (shown instead of your address)"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. zoefunds"
              maxLength={24}
            />
          </div>
          <PrestigeButton type="submit" disabled={usernameBusy || !username}>
            {usernameBusy ? "SAVING…" : "SAVE"}
          </PrestigeButton>
        </form>
        {usernameMsg && (
          <p className="font-mono text-xs text-cyan-soft mt-2">{usernameMsg}</p>
        )}
      </GlassCard>

      <GlassCard className="p-8" scan>
        <h2 className="font-display font-semibold text-xl mb-4">USDC Balance</h2>
        {balances ? (
          <div className="grid grid-cols-3 gap-4 font-mono">
            <div className="bg-black/30 rounded-lg p-4 border border-white/5">
              <MonoLabel className="text-on-variant text-[10px] block mb-1">
                WALLET (Base Sepolia)
              </MonoLabel>
              <p className="font-display font-bold text-cream text-2xl">
                {balances.walletUsdc.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </p>
            </div>
            <div className="bg-black/30 rounded-lg p-4 border border-white/5">
              <MonoLabel className="text-on-variant text-[10px] block mb-1">
                PENDING RELAY
              </MonoLabel>
              <p className="font-display font-bold text-cyan-soft text-2xl">
                {balances.pendingRelayUsdc.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </p>
            </div>
            <div className="bg-black/30 rounded-lg p-4 border border-white/5">
              <MonoLabel className="text-on-variant text-[10px] block mb-1">
                CLAIMABLE (Base Sepolia escrow)
              </MonoLabel>
              <p className="font-display font-bold text-gold-soft text-2xl">
                {balances.totalClaimableUsdc.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </p>
            </div>
          </div>
        ) : (
          <p className="font-mono text-sm text-on-variant">Loading balance…</p>
        )}
        <p className="text-on-variant text-xs mt-4">
          Updates automatically every 10 seconds. WALLET is your real USDC
          balance on Base Sepolia right now. Prize money you've won but that
          hasn't been pushed to the escrow contract yet shows under PENDING
          RELAY; once relayed it becomes claimable (CLAIMABLE) — claim it
          from the{" "}
          <a href="/rewards" className="text-gold-soft underline">Rewards page</a>.
        </p>
      </GlassCard>
    </main>
  );
}

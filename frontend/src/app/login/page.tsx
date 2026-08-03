"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, setSession } from "@/lib/api";
import { connectWallet, signMessage, hasInjectedWallet } from "@/lib/baseSepolia";
import { GlassCard, PrestigeButton, MonoLabel } from "@/components/ui";

export default function Login() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [hasWallet, setHasWallet] = useState(true); // assume yes until checked, avoids hydration flash of the warning

  useEffect(() => {
    setHasWallet(hasInjectedWallet());
  }, []);

  async function connectAndSignIn() {
    setBusy(true);
    setError("");
    try {
      setStep("Connecting wallet…");
      // Pure login — no need to force a Base Sepolia network switch yet.
      const address = await connectWallet({ switchChain: false });

      setStep("Requesting sign-in message…");
      const { message } = await api<{ message: string }>(
        `/api/auth/nonce?address=${encodeURIComponent(address)}`
      );

      setStep("Confirm the sign-in request in your wallet…");
      const signature = await signMessage(address, message);

      setStep("Verifying signature…");
      const res = await api<{ token: string; user: unknown }>(
        "/api/auth/wallet-login",
        { method: "POST", body: JSON.stringify({ address, signature }) }
      );
      setSession(res.token, res.user);
      router.push("/dashboard");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      setStep("");
    }
  }

  return (
    <main className="px-4 md:px-12 py-16 max-w-md mx-auto">
      <GlassCard className="p-8 md:p-10" scan>
        <MonoLabel className="text-cyan-dim">ARENA GATE // AUTH</MonoLabel>
        <h1 className="font-display font-bold text-3xl mt-2 mb-4 text-cream">
          CONNECT WALLET
        </h1>
        <p className="text-on-variant text-sm mb-8">
          No email, no password. Connect your wallet (MetaMask etc.) and sign
          a free message to prove you own it — this creates your account on
          first connect. Your wallet is your identity, and where any prize
          USDC lands.
        </p>
        {!hasWallet && (
          <p className="text-danger font-mono text-xs mb-6">
            No wallet extension detected. Install MetaMask (or another
            browser wallet) to continue.
          </p>
        )}
        {error && <p className="text-danger text-sm font-mono mb-4">{error}</p>}
        <PrestigeButton
          onClick={connectAndSignIn}
          disabled={busy || !hasWallet}
          className="w-full"
        >
          {busy ? step || "WORKING…" : "CONNECT WALLET"}
        </PrestigeButton>
      </GlassCard>
    </main>
  );
}

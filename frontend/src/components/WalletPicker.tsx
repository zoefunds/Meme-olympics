"use client";

import { useEffect, useState } from "react";
import { registerWalletPicker, WalletProvider } from "@/lib/walletProviders";
import { GlassCard, MonoLabel } from "./ui";

export function WalletPicker() {
  const [wallets, setWallets] = useState<WalletProvider[]>([]);
  const [resolveChoice, setResolveChoice] = useState<((wallet: WalletProvider) => void) | null>(null);

  useEffect(() => {
    registerWalletPicker(
      (choices) =>
        new Promise<WalletProvider>((resolve) => {
          setWallets(choices);
          setResolveChoice(() => resolve);
        })
    );
    return () => registerWalletPicker(null);
  }, []);

  if (!resolveChoice) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 px-4">
      <GlassCard className="w-full max-w-sm p-6" scan>
        <MonoLabel className="text-cyan-dim">Wallet provider</MonoLabel>
        <h2 className="font-display text-2xl font-bold text-cream mt-2 mb-5">CHOOSE A WALLET</h2>
        <div className="space-y-3">
          {wallets.map((wallet) => (
            <button
              key={wallet.info.uuid}
              type="button"
              className="w-full flex items-center gap-3 rounded-lg border border-white/15 bg-white/5 p-4 text-left hover:border-cyan-dim/60 hover:bg-white/10 transition-colors"
              onClick={() => {
                resolveChoice(wallet);
                setResolveChoice(null);
                setWallets([]);
              }}
            >
              {wallet.info.icon ? (
                // EIP-6963 icons are data URIs supplied by the wallet extension.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={wallet.info.icon} alt="" className="w-8 h-8 rounded" />
              ) : (
                <span className="w-8 h-8 grid place-items-center rounded bg-purple/40">◈</span>
              )}
              <span className="font-display font-semibold text-cream">{wallet.info.name}</span>
            </button>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}


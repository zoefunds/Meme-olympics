"use client";
import { useState } from "react";
import { api, getToken, setSession } from "@/lib/api";
import { GlassCard, PrestigeButton, MonoLabel, TerminalField } from "@/components/ui";

/** Shown right after a first-time wallet login (no username set yet).
 * Reuses the same PATCH /api/auth/me endpoint as settings/page.tsx. */
export function UsernamePromptModal({
  onDone,
}: {
  onDone: (user: NonNullable<ReturnType<typeof import("@/lib/api").getUser>>) => void;
}) {
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { user: updated } = await api<{ user: NonNullable<ReturnType<typeof import("@/lib/api").getUser>> }>(
        "/api/auth/me",
        { method: "PATCH", body: JSON.stringify({ username }) }
      );
      setSession(getToken()!, updated);
      onDone(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <GlassCard className="p-8 max-w-sm w-full" scan>
        <MonoLabel className="text-cyan-dim">ONE LAST STEP</MonoLabel>
        <h1 className="font-display font-bold text-2xl mt-2 mb-4 text-cream">
          PICK A USERNAME
        </h1>
        <p className="text-on-variant text-sm mb-6">
          Shown instead of your wallet address on leaderboards and arenas.
          You can change it later in Settings.
        </p>
        <form onSubmit={save} className="space-y-4">
          <TerminalField
            label="Display name"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="e.g. zoefunds"
            maxLength={24}
            autoFocus
          />
          {error && <p className="text-danger text-sm font-mono">{error}</p>}
          <PrestigeButton type="submit" disabled={busy || !username} className="w-full">
            {busy ? "SAVING…" : "SAVE & CONTINUE"}
          </PrestigeButton>
        </form>
      </GlassCard>
    </div>
  );
}

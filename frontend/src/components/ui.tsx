"use client";
import React from "react";

/** Segmented "console loading bar" — purple blocks, gold when maxed. */
export function SegmentedBar({
  percent,
  gold = false,
  blocks = 10,
}: {
  percent: number;
  gold?: boolean;
  blocks?: number;
}) {
  const active = Math.round((Math.max(0, Math.min(100, percent)) / 100) * blocks);
  return (
    <div className="segmented-progress">
      {Array.from({ length: blocks }).map((_, i) => (
        <div
          key={i}
          className={`progress-block ${
            i < active ? (gold ? "active-gold" : "active") : ""
          }`}
        />
      ))}
    </div>
  );
}

export function MonoLabel({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`font-mono text-xs uppercase tracking-[0.05em] text-on-variant ${className}`}
    >
      {children}
    </span>
  );
}

/** Pulsing status chip — "AI JUDGE ONLINE" / processing states. */
export function StatusChip({
  label,
  tone = "cyan",
}: {
  label: string;
  tone?: "cyan" | "gold" | "muted";
}) {
  const colors = {
    cyan: "bg-cyan-dim/10 border-cyan-dim/20 text-cyan-dim",
    gold: "bg-gold/10 border-gold/30 text-gold-dim",
    muted: "bg-white/5 border-white/10 text-on-variant",
  }[tone];
  return (
    <span
      className={`inline-flex items-center gap-2 px-3 py-1 rounded border font-mono text-[10px] uppercase tracking-widest ${colors}`}
    >
      <span className={tone === "muted" ? "w-2 h-2 rounded-full bg-on-variant" : "pulse-dot"} />
      {label}
    </span>
  );
}

export function GlassCard({
  children,
  className = "",
  scan = false,
}: {
  children: React.ReactNode;
  className?: string;
  scan?: boolean;
}) {
  return (
    <div className={`glass-panel rounded-xl relative overflow-hidden ${className}`}>
      {scan && <div className="scanline" />}
      {children}
    </div>
  );
}

export function PrestigeButton({
  children,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`prestige-btn px-8 py-3 rounded font-display font-semibold uppercase tracking-widest text-sm disabled:opacity-50 disabled:hover:transform-none ${className}`}
    >
      {children}
    </button>
  );
}

export function GhostButton({
  children,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`border border-white/20 bg-white/5 px-8 py-3 rounded backdrop-blur-md font-display font-semibold uppercase tracking-widest text-sm hover:bg-white/10 transition-all disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  );
}

export function TerminalField({
  label,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <div className="flex flex-col gap-2">
      <MonoLabel>{label}</MonoLabel>
      <input className="terminal-input font-body" {...props} />
    </div>
  );
}

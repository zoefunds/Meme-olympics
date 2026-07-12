"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";

/** Live proof link: points at a real consensus report of the current top
 * judged meme, so anyone can see validators verifying actual outcomes. */
export function ShowcaseLink() {
  const [top, setTop] = useState<{ id: string; title: string; totalScore: number } | null>(null);

  useEffect(() => {
    api<{ showcase: typeof top }>("/api/showcase")
      .then((r) => setTop(r.showcase))
      .catch(() => undefined);
  }, []);

  if (!top) return null;
  return (
    <Link
      href={`/meme/${top.id}`}
      className="inline-flex items-center gap-3 mt-8 glass-panel px-5 py-3 rounded-full border-cyan-soft/30 hover:border-cyan-soft transition-colors group"
    >
      <span className="pulse-dot" />
      <span className="font-mono text-xs text-cyan-soft uppercase tracking-widest">
        See a live consensus verdict: “{top.title}” — {top.totalScore}/100
      </span>
      <span className="text-cyan-soft group-hover:translate-x-1 transition-transform">→</span>
    </Link>
  );
}

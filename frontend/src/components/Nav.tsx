"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "./Logo";
import { getUser, clearSession, shortAddress } from "@/lib/api";

const links = [
  { href: "/arena", label: "Arena" },
  { href: "/arenas", label: "All Arenas" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/disputes", label: "Disputes" },
  { href: "/rewards", label: "Rewards" },
  { href: "/docs", label: "Docs" },
];

export function TopNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<ReturnType<typeof getUser>>(null);
  useEffect(() => setUser(getUser()), [pathname]);

  return (
    <>
      <header className="fixed top-0 left-0 w-full z-50 flex justify-between items-center px-4 md:px-12 h-20 bg-surface/80 backdrop-blur-md border-b border-white/10 shadow-[0_0_15px_rgba(0,219,231,0.1)]">
        <div className="flex items-center gap-8">
          <Link href="/">
            <Logo />
          </Link>
          <nav className="hidden md:flex gap-6 items-center">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={
                  pathname?.startsWith(l.href)
                    ? "text-cream border-b-2 border-gold-soft pb-1 font-display text-sm font-semibold"
                    : "text-on-variant hover:text-on-surface transition-colors font-display text-sm font-semibold"
                }
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {user ? (
            <>
              <Link
                href="/submit"
                className="hidden sm:inline-block prestige-btn px-5 py-2 rounded font-display text-xs font-bold uppercase tracking-widest"
              >
                Submit Meme
              </Link>
              <Link
                href="/dashboard"
                className="font-mono text-xs text-cyan-soft hover:text-cyan transition-colors"
              >
                {user.username ? `@${user.username}` : shortAddress(user.authAddress)}
              </Link>
              {user.role === "admin" && (
                <Link href="/admin" className="font-mono text-xs text-purple-soft">
                  ADMIN
                </Link>
              )}
              <Link href="/settings" className="text-on-variant hover:text-on-surface text-sm">
                ⚙
              </Link>
              <button
                onClick={() => {
                  clearSession();
                  setUser(null);
                  router.push("/");
                }}
                className="text-on-variant hover:text-danger font-mono text-xs uppercase"
              >
                Exit
              </button>
            </>
          ) : (
            <Link
              href="/login"
              className="bg-purple hover:scale-105 active:scale-95 text-white px-6 py-2 rounded-lg font-display text-xs font-semibold uppercase tracking-wider transition-all shadow-[0_0_15px_rgba(119,1,208,0.3)]"
            >
              Connect Wallet
            </Link>
          )}
        </div>
      </header>
      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 w-full z-50 flex justify-around items-center h-16 bg-surface-high/90 backdrop-blur-xl border-t border-white/10 shadow-[0_-4px_20px_rgba(0,0,0,0.5)]">
        {[
          { href: "/arena", label: "Arena", icon: "🏟" },
          { href: "/leaderboard", label: "Ranks", icon: "🏆" },
          { href: "/submit", label: "Submit", icon: "＋" },
          { href: "/dashboard", label: "Me", icon: "👤" },
        ].map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`flex flex-col items-center justify-center font-mono text-[10px] gap-0.5 ${
              pathname?.startsWith(l.href) ? "text-gold-soft scale-110" : "text-on-variant"
            }`}
          >
            <span className="text-base leading-none">{l.icon}</span>
            {l.label}
          </Link>
        ))}
      </nav>
    </>
  );
}

/** Laurel-torch mark — gold laurel wreath around a cyan-purple AI flame. */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden>
      {/* Laurel wreath */}
      <path
        d="M14 20c-3 10 0 24 10 32M50 20c3 10 0 24-10 32"
        stroke="#ffd700"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M12 26l-5-3M13 34l-6-1M16 42l-6 2M21 48l-4 4M52 26l5-3M51 34l6-1M48 42l6 2M43 48l4 4"
        stroke="#e9c400"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      {/* Torch flame */}
      <path
        d="M32 10c5 6 8 10 8 15a8 8 0 11-16 0c0-5 3-9 8-15z"
        fill="#7701d0"
      />
      <path
        d="M32 18c2.5 3 4 5.5 4 8a4 4 0 11-8 0c0-2.5 1.5-5 4-8z"
        fill="#00f1fe"
      />
      {/* Podium base */}
      <rect x="26" y="38" width="12" height="6" rx="1" fill="#ffd700" />
      <rect x="23" y="46" width="18" height="5" rx="1" fill="#e9c400" opacity="0.8" />
    </svg>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <LogoMark size={compact ? 26 : 32} />
      {!compact && (
        <span className="font-display font-bold tracking-tighter text-gold-dim uppercase text-xl">
          Meme Olympics
        </span>
      )}
    </span>
  );
}

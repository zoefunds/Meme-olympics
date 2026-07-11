/** Aura Arena design tokens (from design/DESIGN.md prototype) */
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        background: "#131314",
        surface: "#131314",
        "surface-low": "#1c1b1c",
        "surface-container": "#201f20",
        "surface-high": "#2a2a2b",
        "surface-highest": "#353436",
        "surface-lowest": "#0e0e0f",
        "on-surface": "#e5e2e3",
        "on-variant": "#d0c6ab",
        gold: "#ffd700",
        "gold-dim": "#e9c400",
        "gold-soft": "#ffe16d",
        "on-gold": "#3a3000",
        purple: "#7701d0",
        "purple-soft": "#dcb8ff",
        cyan: "#00f1fe",
        "cyan-dim": "#00dbe7",
        "cyan-soft": "#74f5ff",
        cream: "#fff6df",
        danger: "#ffb4ab",
      },
      fontFamily: {
        display: ["var(--font-grotesk)", "sans-serif"],
        body: ["var(--font-inter)", "sans-serif"],
        mono: ["var(--font-jetbrains)", "monospace"],
      },
      maxWidth: { arena: "1280px" },
    },
  },
  plugins: [],
};

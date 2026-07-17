import Link from "next/link";
import { LogoMark } from "@/components/Logo";
import { ShowcaseLink } from "@/components/Showcase";

/* Landing — modelled on the landing-page prototype: hero with pulsing
   protocol status, "Death of Popularity" headline, evaluation model grid,
   bento features, protocol workflow steps. */
export default function Landing() {
  return (
    <main>
      {/* Hero */}
      <section className="relative px-4 md:px-12 py-20 max-w-arena mx-auto">
        <div className="max-w-4xl">
          <div className="flex items-center gap-2 mb-6">
            <span className="pulse-dot" />
            <span className="font-mono text-xs uppercase tracking-[0.05em] text-cyan-soft">
              GenLayer AI Protocol Active
            </span>
          </div>
          <h1 className="font-display font-bold text-4xl md:text-7xl leading-tight tracking-[-0.02em] mb-8">
            The Death of Popularity.
            <br />
            <span className="text-gold-soft">The Birth of Logic.</span>
          </h1>
          <p className="font-body text-lg text-on-variant max-w-2xl mb-12 leading-7">
            In the Meme Olympics, likes are worthless. Every submission is
            dissected by a decentralized network of AI judges running on the
            GenLayer protocol. Originality, wit, and irony are the only
            currencies that matter.
          </p>
          <div className="flex flex-col sm:flex-row gap-4">
            <Link
              href="/register"
              className="prestige-btn px-10 py-5 rounded font-display font-bold text-xl tracking-tighter inline-flex items-center gap-3"
            >
              ENTER THE ARENA ⚡
            </Link>
            <Link
              href="/leaderboard"
              className="border border-white/20 bg-white/5 px-10 py-5 rounded backdrop-blur-md font-display font-semibold text-sm uppercase tracking-widest hover:bg-white/10 transition-all inline-flex items-center"
            >
              View Leaderboard
            </Link>
          </div>
          <ShowcaseLink />
        </div>
        {/* Floating judged-card mockup */}
        <div className="hidden xl:block absolute right-12 top-16 w-80 glass-panel p-6 rounded-xl border-white/20 rotate-3 shadow-2xl">
          <div className="relative aspect-square mb-4 overflow-hidden rounded bg-black flex items-center justify-center">
            <LogoMark size={120} />
            <div className="absolute top-2 right-2 glass-panel px-3 py-1 rounded flex items-center gap-2 font-mono text-[10px]">
              <span className="pulse-dot" /> AI ANALYZING…
            </div>
            <div className="scanline" />
          </div>
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="font-display font-semibold">GLADIATOR.EXE</span>
              <span className="text-gold-soft font-mono text-xs">#4201</span>
            </div>
            <div className="h-2 w-full bg-white/10 rounded-full overflow-hidden">
              <div className="h-full bg-gold w-3/4 shadow-[0_0_10px_#ffd700]" />
            </div>
            <div className="flex justify-between font-mono text-[10px] text-on-variant">
              <span>ORIGINALITY: 92%</span>
              <span>IRONY: 78%</span>
            </div>
          </div>
        </div>
      </section>

      {/* Evaluation model */}
      <section className="px-4 md:px-12 py-20 bg-surface-low/30">
        <div className="max-w-arena mx-auto">
          <h2 className="font-display font-bold text-3xl md:text-5xl mb-16 text-center">
            Objective <span className="text-cyan-soft">Consensus</span>
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            {[
              {
                icon: "🧠",
                title: "Originality",
                text: "Validators cross-examine every meme against known formats and prior submissions to reward true novelty — recycled reposts get disqualified on-chain.",
              },
              {
                icon: "🎭",
                title: "Humor Analysis",
                text: "LLM validators evaluate comedic timing, punchline impact, and cultural resonance — then must agree within strict tolerances.",
              },
              {
                icon: "🌗",
                title: "Irony Vector",
                text: "The distance between literal meaning and intended subtext is scored to reward sophisticated crypto-native irony.",
              },
              {
                icon: "✅",
                title: "Consensus Score",
                text: "The final synthesis across 9 weighted criteria, verified by GenLayer Intelligent Contract validator consensus.",
              },
            ].map((f) => (
              <div key={f.title} className="glass-panel p-8 rounded-xl relative overflow-hidden group">
                <div className="scanline opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="text-4xl mb-6">{f.icon}</div>
                <h3 className="font-display font-semibold text-xl mb-4">{f.title}</h3>
                <p className="text-on-variant text-sm leading-relaxed">{f.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Bento features */}
      <section className="px-4 md:px-12 py-20">
        <div className="max-w-arena mx-auto grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-2 glass-panel p-10 rounded-xl flex flex-col justify-end min-h-[320px] relative overflow-hidden">
            <div className="scanline-texture absolute inset-0" />
            <div className="relative z-10">
              <div className="inline-flex items-center gap-2 bg-gold-soft text-black px-3 py-1 rounded-full text-[10px] font-mono font-bold mb-4">
                REAL GEN PRIZE POOLS
              </div>
              <h3 className="font-display font-bold text-5xl mb-4 text-gold">
                Fund it. Win it. Claim it.
              </h3>
              <p className="text-on-variant max-w-md">
                Hosts fund arenas with real GEN straight from their own
                wallet, split 50/30/20 across the podium. Winners are chosen
                by validator consensus and pull their GEN directly from the
                contract with a self-serve claim — a genuine on-chain value
                transfer, not points.
              </p>
            </div>
          </div>
          <div className="glass-panel p-10 rounded-xl flex flex-col justify-center border-cyan-soft/30">
            <div className="text-5xl mb-6">🛡</div>
            <h3 className="font-display font-semibold text-2xl mb-4">
              Anti-Plagiarism Engine
            </h3>
            <p className="text-on-variant text-sm">
              Duplicate URLs are rejected on-chain; validators independently
              classify each meme as original, suspicious or copied — and
              disputes are resolved from fetched web evidence, never hearsay.
            </p>
          </div>
          <div className="glass-panel p-10 rounded-xl flex flex-col justify-center border-purple/30">
            <div className="text-5xl mb-6">🕸</div>
            <h3 className="font-display font-semibold text-2xl mb-4">
              Intelligent Contract Consensus
            </h3>
            <p className="text-on-variant text-sm">
              No single AI decides. A leader scores, validators re-score
              independently, and agreement within tolerance is required before
              anything settles.
            </p>
          </div>
          <div className="md:col-span-2 glass-panel p-10 rounded-xl flex items-center justify-between gap-10">
            <div>
              <h3 className="font-display font-semibold text-2xl mb-4">
                A Wallet You Can't Lose
              </h3>
              <p className="text-on-variant text-sm">
                Registration creates a GenLayer wallet permanently linked to
                your account. It survives device changes, browser resets and
                reinstalls — and your private key is exportable anytime.
              </p>
            </div>
            <div className="hidden sm:flex w-40 h-40 bg-white/5 border border-white/10 rounded-full items-center justify-center relative">
              <div className="absolute inset-4 border border-gold-soft/20 rounded-full animate-spin [animation-duration:12s]" />
              <LogoMark size={64} />
            </div>
          </div>
        </div>
      </section>

      {/* Protocol workflow */}
      <section className="px-4 md:px-12 py-24 bg-black">
        <div className="max-w-3xl mx-auto">
          <h2 className="font-display font-bold text-4xl md:text-5xl mb-16 text-center">
            Protocol Workflow
          </h2>
          <div className="space-y-12">
            {[
              ["01", "Submit Your Asset", "Upload your meme. Metadata and the image URL are locked into the intelligent contract, signed by your own wallet."],
              ["02", "AI Validation Queue", "GenLayer validators fetch your image on-chain and score 9 weighted criteria: originality, humor, relevance, timing, irony and more."],
              ["03", "Consensus Finality", "The leader's verdict is independently re-derived by every validator. Only tolerant agreement finalizes your score."],
              ["04", "Claim Glory", "Podium finishers split the weekly pool. Results, rewards and disputes are all auditable on-chain."],
            ].map(([n, title, text], i) => (
              <div key={n} className="flex gap-8 group">
                <div
                  className={`flex-shrink-0 w-16 h-16 rounded-full border border-white/20 flex items-center justify-center font-display font-semibold text-2xl transition-all ${
                    ["group-hover:bg-gold-soft", "group-hover:bg-cyan-soft", "group-hover:bg-purple-soft", "group-hover:bg-gold-dim"][i]
                  } group-hover:text-black`}
                >
                  {n}
                </div>
                <div className="pt-2">
                  <h4 className="font-display font-semibold text-xl mb-2">{title}</h4>
                  <p className="text-on-variant">{text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-4 md:px-12 py-12 border-t border-white/5">
        <div className="max-w-arena mx-auto flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="font-display text-on-surface/50 uppercase tracking-tighter text-sm">
            MEME OLYMPICS © 2026
          </div>
          <div className="flex gap-8">
            <Link href="/docs" className="text-on-variant hover:text-white font-mono text-[10px] uppercase">Docs</Link>
            <a href="https://github.com/zoefunds/Meme-olympics" className="text-on-variant hover:text-white font-mono text-[10px] uppercase">Github</a>
            <a href="https://genlayer.com" className="text-on-variant hover:text-white font-mono text-[10px] uppercase">GenLayer</a>
          </div>
          <div className="flex items-center gap-2 font-mono text-[10px] text-cyan-soft">
            <span className="w-2 h-2 rounded-full bg-cyan-soft shadow-[0_0_5px_#74f5ff]" />
            NETWORK STATUS: OPERATIONAL
          </div>
        </div>
      </footer>
    </main>
  );
}

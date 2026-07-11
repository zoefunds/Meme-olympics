import { MonoLabel, SegmentedBar, GlassCard, StatusChip } from "@/components/ui";

/* Docs — modelled on the Docs prototype: versioned header, weighted
   evaluation model with progress bars, aggregated score dial, code panel,
   validator network cards. */

const WEIGHTS: Array<[string, number]> = [
  ["ORIGINALITY", 16],
  ["HUMOR", 16],
  ["CRYPTO-NATIVE UNDERSTANDING", 14],
  ["RELEVANCE", 12],
  ["CULTURAL AWARENESS", 10],
  ["TIMING", 9],
  ["IRONY", 8],
  ["CREATIVITY", 8],
  ["CONTEXTUAL INTELLIGENCE", 7],
];

export default function Docs() {
  return (
    <main className="px-4 md:px-12 py-12 max-w-5xl mx-auto">
      <header className="mb-16">
        <div className="flex items-center gap-4 mb-6">
          <span className="font-mono text-xs px-3 py-1 bg-cyan-soft/10 border border-cyan-soft/20 text-cyan-soft rounded-full">
            v1.0.0-STUDIONET
          </span>
          <span className="text-on-variant/40">—</span>
          <MonoLabel>Judged by GenLayer Intelligent Contracts</MonoLabel>
        </div>
        <h1 className="font-display font-bold text-4xl md:text-5xl text-cream mb-4">
          Intelligent Meme Contracts
        </h1>
        <p className="text-lg text-on-variant max-w-2xl leading-relaxed">
          Meme Olympics uses GenLayer&apos;s decentralized AI architecture to
          automate judging and rewards. Every submission is an on-chain asset
          governed by machine-logic consensus — never by likes.
        </p>
      </header>

      {/* Scoring model */}
      <section className="mb-20">
        <div className="flex items-center gap-4 mb-8">
          <div className="h-px flex-1 bg-gradient-to-r from-cyan-soft/50 to-transparent" />
          <h2 className="font-display font-semibold text-3xl text-white whitespace-nowrap">
            Weighted Evaluation Model
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <GlassCard className="p-8">
            <h3 className="font-display font-semibold text-2xl text-cyan-soft mb-4">The Logic</h3>
            <p className="text-on-variant mb-6 leading-relaxed text-sm">
              Instead of community voting, validators score nine
              reasoning-based criteria (each 0–10) and combine them with the
              on-chain weights below. This prevents bot-raiding and rewards
              objective quality.
            </p>
            <div className="space-y-5">
              {WEIGHTS.map(([label, w]) => (
                <div key={label}>
                  <div className="flex justify-between items-end mb-2">
                    <span className="font-mono text-xs text-white">{label}</span>
                    <span className="font-mono text-xs text-cyan-dim">{w}%</span>
                  </div>
                  <SegmentedBar percent={w * 5} blocks={20} />
                </div>
              ))}
            </div>
          </GlassCard>
          <div className="bg-surface-highest p-8 rounded-xl border border-white/5 flex flex-col justify-center">
            <div className="aspect-square relative flex items-center justify-center p-8 bg-black/40 rounded-full border border-dashed border-white/20">
              <div className="absolute inset-0 flex items-center justify-center opacity-30">
                <div className="w-full h-full border-[10px] border-cyan-soft rounded-full animate-spin [animation-duration:20s] border-t-transparent" />
                <div className="absolute w-[80%] h-[80%] border-2 border-purple-soft border-dashed rounded-full animate-spin [animation-duration:15s] [animation-direction:reverse]" />
              </div>
              <div className="text-center z-10">
                <MonoLabel className="text-cyan-dim block mb-2">AI CONSENSUS NODE</MonoLabel>
                <div className="font-display font-semibold text-5xl text-white">94.2</div>
                <MonoLabel className="block mt-2 tracking-widest">Aggregated Score</MonoLabel>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Contract snippet */}
      <section className="mb-20">
        <div className="flex items-center gap-4 mb-8">
          <div className="h-px flex-1 bg-gradient-to-r from-purple/50 to-transparent" />
          <h2 className="font-display font-semibold text-3xl text-white whitespace-nowrap">
            How Consensus Works
          </h2>
        </div>
        <GlassCard>
          <div className="bg-surface-high px-6 py-3 border-b border-white/5 flex items-center gap-4">
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full bg-danger/40" />
              <div className="w-3 h-3 rounded-full bg-gold/40" />
              <div className="w-3 h-3 rounded-full bg-cyan/40" />
            </div>
            <span className="font-mono text-xs text-on-variant">meme_olympics.py</span>
          </div>
          <div className="p-6 overflow-x-auto">
            <pre className="font-mono text-[13px] leading-relaxed text-purple-soft">{`# Leader judges the meme; every validator independently re-judges
def validator_fn(leaders_res):
    mine = leader_fn()   # validator runs the SAME task itself

    # Hard gate: both must agree on plagiarism disqualification
    if leader_disqualified != my_disqualified: return False

    # Total score must agree within ±15/100
    if abs(leader_score - mine_score) > 15: return False

    # 7 of 9 criteria within ±5 — tolerant, but a lying leader fails
    return criteria_close_enough(leader, mine)

gl.vm.run_nondet_unsafe(leader_fn, validator_fn)`}</pre>
          </div>
        </GlassCard>
      </section>

      {/* Validator network */}
      <section className="mb-12">
        <div className="flex items-center gap-4 mb-8">
          <div className="h-px flex-1 bg-gradient-to-r from-gold-soft/50 to-transparent" />
          <h2 className="font-display font-semibold text-3xl text-white whitespace-nowrap">
            Validator Network
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            ["🕸", "Decentralized Logic", "No single server judges a meme. The leader proposes, validators independently re-derive, and only tolerant agreement finalizes state."],
            ["📜", "Immutable Attestation", "Every decision — scores, plagiarism verdicts, dispute outcomes — is recorded on the GenLayer ledger and readable by anyone."],
            ["⚖️", "Evidence-Based Disputes", "Disputes require a public evidence URL. The contract fetches it on-chain; claims are never resolved from user text alone."],
          ].map(([icon, title, text]) => (
            <GlassCard key={title as string} className="p-6 hover:border-cyan-soft/40 transition-colors">
              <div className="w-12 h-12 bg-cyan-soft/10 rounded-lg flex items-center justify-center mb-6 text-2xl">
                {icon}
              </div>
              <h4 className="font-display font-semibold text-xl text-white mb-3">{title}</h4>
              <p className="text-on-variant text-sm leading-relaxed">{text}</p>
            </GlassCard>
          ))}
        </div>
      </section>

      <div className="flex justify-center">
        <StatusChip label="AI Judge Online — hourly consensus sweeps" />
      </div>
    </main>
  );
}

"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, getUser, API_URL } from "@/lib/api";
import { GlassCard, MonoLabel, PrestigeButton, SegmentedBar } from "@/components/ui";

/* Submit Entry — modelled on the Submit-Entry prototype: 3-step flow
   (Asset → Context → Pre-Flight) with terminal inputs, tags, analysis log. */

const STEPS = ["Asset", "Context", "Pre-Flight"];

export default function Submit() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [arenas, setArenas] = useState<Array<{ id: string; title: string; status: string }>>([]);
  const [compId, setCompId] = useState("");
  const [form, setForm] = useState({
    imageUrl: "",
    title: "",
    caption: "",
    contextUrl: "",
    tags: [] as string[],
  });
  const [tagInput, setTagInput] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!getUser()) router.push("/login");
    api<{ competitions: Array<{ id: string; title: string; status: string }> }>(
      "/api/competitions"
    )
      .then((r) => {
        const open = r.competitions.filter((c) => c.status === "open");
        setArenas(open);
        if (open[0]) setCompId(open[0].id);
      })
      .catch(() => setArenas([]));
  }, [router]);

  async function uploadFile(file: File) {
    setUploadErr("");
    if (file.size > 3 * 1024 * 1024) {
      setUploadErr("Max file size is 3MB");
      return;
    }
    setUploading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const res = await api<{ url: string }>("/api/uploads", {
        method: "POST",
        body: JSON.stringify({ dataUrl }),
      });
      setForm((f) => ({ ...f, imageUrl: res.url }));
    } catch (err) {
      setUploadErr((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  function addTag() {
    const t = tagInput.trim().replace(/^#/, "");
    if (t && form.tags.length < 8 && !form.tags.includes(t)) {
      setForm({ ...form, tags: [...form.tags, t] });
    }
    setTagInput("");
  }

  async function submit() {
    if (!compId) return;
    setBusy(true);
    setError("");
    const lines = [
      "> Initializing GenLayer Neural Engine…",
      "> Connection secure. Protocol 0xMEME active.",
      "> Locking metadata into intelligent contract…",
      "> Signing with your arena wallet…",
      "> Broadcasting to validator set…",
    ];
    lines.forEach((l, i) => setTimeout(() => setLog((p) => [...p, l]), i * 500));
    try {
      await api("/api/submissions", {
        method: "POST",
        body: JSON.stringify({
          competitionId: compId,
          title: form.title,
          caption: form.caption,
          imageUrl: form.imageUrl,
          contextUrl: form.contextUrl || "",
          tags: form.tags,
        }),
      });
      setTimeout(() => {
        setLog((p) => [...p, "> SUBMISSION ACCEPTED. Awaiting AI consensus judging."]);
        setDone(true);
      }, lines.length * 500);
    } catch (err) {
      setError((err as Error).message);
      setLog((p) => [...p, `> ERROR: ${(err as Error).message}`]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="px-4 md:px-12 py-8 max-w-4xl mx-auto">
      <header className="mb-10">
        <h1 className="font-display font-bold text-4xl md:text-5xl mb-2 text-cream">SUBMIT MEME</h1>
        <p className="text-on-variant max-w-2xl">
          Enter the arena. Your submission
          will be judged by GenLayer validator consensus on originality,
          cultural relevance, humor and 6 more criteria.
        </p>
      </header>

      <GlassCard className="p-8 md:p-12" scan>
        {/* Progress tracker */}
        <div className="flex justify-between items-center mb-12 relative">
          <div className="absolute top-5 left-0 w-full h-px bg-white/10" />
          {STEPS.map((label, i) => (
            <div key={label} className={`flex flex-col items-center gap-2 relative z-10 ${step > i ? "" : "opacity-40"}`}>
              <div
                className={`w-10 h-10 rounded-full glass-panel flex items-center justify-center font-mono text-xs ${
                  step === i + 1 ? "border-cream text-cream bg-surface-container" : step > i + 1 ? "bg-cyan-dim text-black" : "bg-surface-container"
                }`}
              >
                0{i + 1}
              </div>
              <MonoLabel>{label}</MonoLabel>
            </div>
          ))}
        </div>

        {/* Step 1: asset */}
        {step === 1 && (
          <div className="max-w-2xl mx-auto space-y-8">
            <div className="flex flex-col gap-2">
              <MonoLabel>Choose your arena ({arenas.length} open)</MonoLabel>
              <select
                className="terminal-input font-mono text-sm bg-surface-container [color-scheme:dark] cursor-pointer"
                value={compId}
                onChange={(e) => setCompId(e.target.value)}
              >
                {arenas.length === 0 && <option value="">No open arenas</option>}
                {arenas.map((a) => (
                  <option key={a.id} value={a.id} className="bg-surface-container">
                    {a.title}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <h2 className="font-display font-semibold text-2xl mb-2 text-purple-soft">SELECT YOUR ASSET</h2>
              <p className="text-on-variant text-sm mb-6">
                Upload your meme (recommended — hosted on Arena infrastructure
                that GenLayer validators can always reach) or paste a public
                direct image URL. Validators fetch this image on-chain;
                unreachable images get disqualified.
              </p>
              <label className="cursor-pointer group block mb-6">
                <div className="glass-panel border-dashed border-2 border-white/20 rounded-xl h-40 flex flex-col items-center justify-center hover:border-cyan-soft transition-all hover:bg-white/5">
                  <span className="text-4xl mb-2">☁️</span>
                  <MonoLabel className="group-hover:text-cyan-soft">
                    {uploading ? "UPLOADING…" : "CLICK TO UPLOAD (PNG/JPG/GIF/WEBP, ≤3MB)"}
                  </MonoLabel>
                </div>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  className="hidden"
                  disabled={uploading}
                  onChange={(e) => e.target.files?.[0] && uploadFile(e.target.files[0])}
                />
              </label>
              {uploadErr && <p className="text-danger font-mono text-xs mb-4">{uploadErr}</p>}
              <div className="flex flex-col gap-2">
                <MonoLabel>…or paste a public image URL</MonoLabel>
                <input
                  className="terminal-input font-mono text-sm"
                  placeholder="https://files.catbox.moe/your-meme.png"
                  value={form.imageUrl.startsWith(API_URL) ? "" : form.imageUrl}
                  onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
                />
                {form.imageUrl.startsWith(API_URL) && (
                  <p className="font-mono text-[10px] text-cyan-soft">
                    ✓ Uploaded to Arena hosting: {form.imageUrl}
                  </p>
                )}
              </div>
            </div>
            {form.imageUrl.startsWith("http") && (
              <div className="glass-panel border-dashed border-2 border-white/20 rounded-xl overflow-hidden max-h-72 flex items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={form.imageUrl} alt="preview" className="max-h-72 object-contain" />
              </div>
            )}
            <div className="flex justify-end">
              <PrestigeButton disabled={!form.imageUrl.startsWith("http")} onClick={() => setStep(2)}>
                Continue →
              </PrestigeButton>
            </div>
          </div>
        )}

        {/* Step 2: context */}
        {step === 2 && (
          <div className="max-w-2xl mx-auto">
            <h2 className="font-display font-semibold text-2xl mb-8 text-purple-soft">MISSION DATA</h2>
            <div className="space-y-8">
              <div className="flex flex-col gap-2">
                <MonoLabel>Entry Title</MonoLabel>
                <input
                  className="terminal-input font-display text-2xl py-2"
                  placeholder="THE GREAT FLOP"
                  maxLength={120}
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-2">
                <MonoLabel>Meme Lore / Context</MonoLabel>
                <textarea
                  className="terminal-input font-body resize-none"
                  rows={3}
                  maxLength={600}
                  placeholder="Explain the cultural significance or origin… the AI weighs this for Relevance and Timing."
                  value={form.caption}
                  onChange={(e) => setForm({ ...form, caption: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-2">
                <MonoLabel>Context URL (optional — proof of timeliness)</MonoLabel>
                <input
                  className="terminal-input font-mono text-sm"
                  placeholder="https://x.com/... (the news/event your meme references)"
                  value={form.contextUrl}
                  onChange={(e) => setForm({ ...form, contextUrl: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-2">
                <MonoLabel>Tags (max 8)</MonoLabel>
                <div className="flex flex-wrap gap-2 items-center">
                  {form.tags.map((t) => (
                    <button
                      key={t}
                      onClick={() => setForm({ ...form, tags: form.tags.filter((x) => x !== t) })}
                      className="px-3 py-1 glass-panel text-cyan-soft font-mono text-xs rounded-full border-cyan-soft/30"
                    >
                      #{t.toUpperCase()} ✕
                    </button>
                  ))}
                  <input
                    className="terminal-input font-mono text-xs w-32"
                    placeholder="+ ADD TAG"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addTag())}
                  />
                </div>
              </div>
            </div>
            <div className="mt-12 flex justify-between">
              <button className="font-mono text-xs text-on-variant hover:text-white" onClick={() => setStep(1)}>
                ← BACK
              </button>
              <PrestigeButton disabled={!form.title} onClick={() => setStep(3)}>
                Start AI Pre-Flight
              </PrestigeButton>
            </div>
          </div>
        )}

        {/* Step 3: pre-flight + submit */}
        {step === 3 && (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            <div className="lg:col-span-2 glass-panel p-6 rounded-lg bg-black/40 flex flex-col">
              <div className="flex justify-between items-center mb-6">
                <span className="font-mono text-xs text-cyan-soft">ANALYSIS_LOG_V2.0</span>
                <span className="pulse-dot" />
              </div>
              <div className="font-mono text-[10px] space-y-2 text-on-variant min-h-[200px]">
                <div>&gt; Pre-flight checklist ready.</div>
                <div className="text-cyan-soft">&gt; {form.tags.length} tags · title “{form.title}”</div>
                <div className="text-gold-soft">&gt; Target arena: {arenas.find((a) => a.id === compId)?.title || "none selected"}</div>
                <div>&gt; On submit: metadata locks on-chain, then validators judge 9 criteria + plagiarism.</div>
                {log.map((l, i) => (
                  <div key={i} className={l.includes("ERROR") ? "text-danger" : l.includes("ACCEPTED") ? "text-gold-soft" : ""}>
                    {l}
                  </div>
                ))}
              </div>
            </div>
            <div className="lg:col-span-3 flex flex-col gap-6">
              <div className="glass-panel p-8 rounded-xl border-cream/20 relative overflow-hidden">
                <MonoLabel className="block mb-6">Judging Criteria Weights</MonoLabel>
                <div className="space-y-4">
                  {[
                    ["ORIGINALITY", 16],
                    ["HUMOR", 16],
                    ["CRYPTO-NATIVE UNDERSTANDING", 14],
                    ["RELEVANCE", 12],
                    ["CULTURAL AWARENESS", 10],
                  ].map(([label, w]) => (
                    <div key={label as string}>
                      <div className="flex justify-between font-mono text-xs mb-2">
                        <span>{label}</span>
                        <span className="text-cyan-dim">{w}%</span>
                      </div>
                      <SegmentedBar percent={(w as number) * 5} />
                    </div>
                  ))}
                </div>
              </div>
              {error && <p className="text-danger font-mono text-xs">{error}</p>}
              {done ? (
                <PrestigeButton onClick={() => router.push("/dashboard")} className="w-full py-5">
                  View in Dashboard →
                </PrestigeButton>
              ) : (
                <button
                  onClick={submit}
                  disabled={busy || !compId}
                  className="w-full py-5 bg-gradient-to-r from-gold-dim to-cream text-on-gold font-display font-semibold uppercase tracking-[0.2em] rounded shadow-[0_0_30px_rgba(233,196,0,0.2)] hover:shadow-[0_0_40px_rgba(233,196,0,0.4)] transition-all disabled:opacity-50"
                >
                  {busy ? "TRANSMITTING…" : compId ? "SUBMIT TO ARENA ➤" : "NO OPEN COMPETITION"}
                </button>
              )}
              <div className="flex justify-start">
                <button className="font-mono text-xs text-on-variant hover:text-white" onClick={() => setStep(2)}>
                  ← BACK
                </button>
              </div>
            </div>
          </div>
        )}
      </GlassCard>

      <div className="mt-8 flex items-center gap-4 glass-panel px-4 py-2 rounded-full border-white/5 w-fit">
        <span className="text-cyan-soft">🛡</span>
        <MonoLabel>Immutable Submission • GenLayer Verifiable</MonoLabel>
      </div>
    </main>
  );
}

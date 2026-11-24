import { useState } from "react";
import { Mic, Headphones, Info } from "lucide-react";
import { SOURCE_LANGUAGES, TARGET_LANGUAGES, STATUS_LABEL, TESTED_LANGUAGE_CODES, isComingSoon } from "@/lib/languages";
import { cn } from "@/lib/utils";

function Wave({ active, bars = 28 }: { active: boolean; bars?: number }) {
  return (
    <div className="flex h-8 items-center gap-[3px]" aria-hidden>
      {Array.from({ length: bars }).map((_, i) => (
        <span
          key={i}
          className={cn("w-[3px] rounded-full", active ? "animate-wave bg-foreground/70" : "bg-border")}
          style={{ height: `${30 + ((i * 37) % 70)}%`, animationDelay: `${(i % 9) * 0.09}s` }}
        />
      ))}
    </div>
  );
}

export function LiveDemo() {
  const [source, setSource] = useState("en");
  const [selected, setSelected] = useState<string[]>([...TESTED_LANGUAGE_CODES]);
  const [micOn, setMicOn] = useState(false);
  const toggle = (c: string) => {
    if (isComingSoon(c)) return;
    setSelected((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]));
  };
  const targets = TARGET_LANGUAGES.filter((l) => l.code !== source);

  return (
    <div className="overflow-hidden rounded-3xl border bg-card shadow-card">
      <div className="flex items-center justify-between border-b px-5 py-3">
        <div className="flex gap-1.5">
          {[0, 1, 2].map((i) => <span key={i} className="size-2.5 rounded-full bg-border" />)}
        </div>
        <span className="flex items-center gap-2 font-mono text-[11px] tracking-widest text-muted-foreground uppercase">
          <span className="size-1.5 rounded-full bg-warning" /> Interactive preview · not live AI
        </span>
      </div>

      <div className="grid gap-6 p-6 md:grid-cols-[280px_1fr] md:p-8">
        <div className="space-y-5">
          <label className="block">
            <span className="font-mono text-[11px] tracking-widest text-muted-foreground uppercase">Source language</span>
            <select
              value={source}
              onChange={(e) => { setSource(e.target.value); setSelected((s) => s.filter((c) => c !== e.target.value)); }}
              className="mt-2 w-full rounded-xl border bg-background px-3 py-2.5 text-sm"
            >
              {SOURCE_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
            </select>
          </label>

          <div className="rounded-2xl border bg-background p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Pulpit microphone</span>
              <span className={cn("font-mono text-[11px] uppercase", micOn ? "text-live" : "text-muted-foreground")}>
                {micOn ? "Simulated input" : "Idle"}
              </span>
            </div>
            <div className="mt-3"><Wave active={micOn} /></div>
            <button
              onClick={() => setMicOn((m) => !m)}
              className={cn(
                "mt-4 flex w-full items-center justify-center gap-2 rounded-full py-2.5 text-sm font-medium transition",
                micOn ? "bg-secondary text-foreground" : "bg-primary text-primary-foreground hover:opacity-90",
              )}
            >
              <Mic className="size-4" /> {micOn ? "Stop preview" : "Simulate speaking"}
            </button>
          </div>

          <div>
            <span className="font-mono text-[11px] tracking-widest text-muted-foreground uppercase">Target channels</span>
            <div className="mt-2 flex flex-wrap gap-2">
              {targets.map((l) => {
                const soon = isComingSoon(l.code);
                return (
                  <button
                    key={l.code}
                    onClick={() => toggle(l.code)}
                    disabled={soon}
                    aria-disabled={soon}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs transition",
                      soon ? "cursor-not-allowed bg-secondary text-muted-foreground" :
                      selected.includes(l.code) ? "border-foreground bg-foreground text-background" : "bg-background hover:border-foreground/40",
                    )}
                  >
                    {l.name}{soon && <span className="ml-1.5 font-mono text-[10px] uppercase">· Coming soon</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="grid content-start gap-3 sm:grid-cols-2">
          {selected.length === 0 && (
            <p className="col-span-full rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
              Choose at least one target channel.
            </p>
          )}
          {targets.filter((l) => selected.includes(l.code)).map((l) => {
            const processing = micOn && !isComingSoon(l.code);
            return (
              <div key={l.code} className="rounded-2xl border bg-background p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-display text-lg leading-none">{l.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{l.native} · {l.code}</p>
                  </div>
                  <Headphones className="size-4 text-muted-foreground" />
                </div>
                <div className="mt-3"><Wave active={processing} bars={22} /></div>
                <div className="mt-3 flex items-center justify-between text-[11px]">
                  <span className="font-mono text-muted-foreground uppercase">
                    {l.pipeline === "direct" ? "Speech → speech" : "ASR → MT → TTS"}
                  </span>
                  <span className={cn(
                    "rounded-full px-2 py-0.5 font-medium",
                    isComingSoon(l.code) ? "bg-secondary text-muted-foreground" : "bg-accent text-accent-foreground",
                  )}>
                    {processing ? "Preview signal" : STATUS_LABEL[l.status]}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <p className="flex items-center gap-2 border-t px-6 py-3 text-xs text-muted-foreground">
        <Info className="size-3.5" /> Waveforms here are illustrative. No audio is captured or translated in this preview.
      </p>
    </div>
  );
}

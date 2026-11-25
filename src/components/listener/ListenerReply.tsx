import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Mic, Square, Loader2 } from "lucide-react";
import { openClipRecorder, type ClipRecorder } from "@/components/live/clipRecorder";
import { replyFromListener } from "@/lib/replies.functions";
import { TARGET_LANGUAGES } from "@/lib/languages";

const MAX_REPLY_SECONDS = 10;

/**
 * Lets a listener answer the preacher in their own language. The reply is transcribed, translated to English
 * and shown to the preacher in the control view. One reply at a time.
 */
export function ListenerReply({ code, language, live }: { code: string; language: string; live: boolean }) {
  const reply = useServerFn(replyFromListener);
  const [phase, setPhase] = useState<"idle" | "recording" | "sending" | "sent" | "error">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<{ original: string; english: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const recorderRef = useRef<ClipRecorder | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const langName = TARGET_LANGUAGES.find((l) => l.code === language)?.name ?? language;

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); recorderRef.current?.cancel(); }, []);

  async function send() {
    const rec = recorderRef.current; if (!rec) return;
    if (timerRef.current) clearInterval(timerRef.current);
    recorderRef.current = null;
    const clip = rec.stop();
    setPhase("sending");
    try {
      const out = await reply({ data: { code, language: language as "fr" | "es", audioBase64: clip.audioBase64 } });
      setResult(out); setPhase("sent");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Your reply could not be sent."); setPhase("error");
    }
  }

  async function start() {
    setMessage(null); setResult(null);
    try {
      const rec = await openClipRecorder();
      recorderRef.current = rec;
      setElapsed(0); setPhase("recording");
      timerRef.current = setInterval(() => {
        const t = rec.elapsed();
        setElapsed(Math.floor(t));
        if (t >= MAX_REPLY_SECONDS) void send();
      }, 250);
    } catch {
      setMessage("Microphone access is needed to reply. Allow it in your browser and try again."); setPhase("error");
    }
  }

  if (!live) return null;

  return (
    <div className="mt-6 rounded-3xl border bg-card p-6 text-center shadow-card">
      <p className="font-medium">Answer the preacher</p>
      <p className="mt-1 text-xs text-muted-foreground">Speak in {langName}, up to {MAX_REPLY_SECONDS} seconds. The preacher sees your reply in English.</p>

      {phase === "recording" ? (
        <button onClick={() => void send()} className="mt-4 inline-flex items-center gap-2 rounded-full bg-secondary px-5 py-2.5 text-sm font-medium">
          <Square className="size-4" /> Send reply ({elapsed}s)
        </button>
      ) : phase === "sending" ? (
        <p className="mt-4 inline-flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Sending…</p>
      ) : (
        <button onClick={start} className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground">
          <Mic className="size-4" /> {phase === "sent" ? "Reply again" : "Reply"}
        </button>
      )}

      {message && <p className="mt-3 text-sm text-destructive">{message}</p>}
      {result && (
        <div className="mt-4 space-y-2 text-left">
          <p className="text-sm text-muted-foreground">You said: {result.original}</p>
          <p className="font-display text-lg">In English: {result.english}</p>
        </div>
      )}
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { Pause, Play, Headphones } from "lucide-react";
import { TARGET_LANGUAGES } from "@/lib/languages";
import { getPublicRecording } from "@/lib/recordings.functions";

export const Route = createFileRoute("/r/$code")({
  head: () => ({ meta: [{ title: "Listen — Logosphere" }, { name: "description", content: "Listen to a translated sermon on Logosphere." }] }),
  component: RecordingPage,
});

type Piece = { language: string; index: number; startSeconds: number; endSeconds: number; english: string; translation: string; url: string | null };
type RecordingData = { title: string; durationSeconds: number; languages: string[]; pieces: Piece[] } | null;

function RecordingPage() {
  const { code } = Route.useParams();
  const fetchRecording = useServerFn(getPublicRecording);
  const { data, isLoading } = useQuery({ queryKey: ["public-recording", code], queryFn: (): Promise<RecordingData> => fetchRecording({ data: { code } }) as Promise<RecordingData> });

  const [lang, setLang] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runRef = useRef(0);

  useEffect(() => { if (data && !lang) setLang(data.languages[0] ?? null); }, [data, lang]);
  useEffect(() => () => stop(), []);

  const pieces: Piece[] = (data?.pieces ?? []).filter((p) => p.language === lang).sort((a, b) => a.index - b.index);
  const name = (code: string) => TARGET_LANGUAGES.find((l) => l.code === code)?.name ?? code;

  function stop() {
    runRef.current += 1;
    audioRef.current?.pause(); audioRef.current = null;
    if (timerRef.current) clearTimeout(timerRef.current); timerRef.current = null;
    setPlaying(false);
  }

  /** Plays pieces strictly in order. A piece with no audio (silence) waits for its own length. */
  function playFrom(i: number, run: number) {
    if (run !== runRef.current) return;
    if (i >= pieces.length) { setPlaying(false); setCurrent(0); return; }
    setCurrent(i);
    const piece = pieces[i]!;
    const next = () => playFrom(i + 1, run);
    if (!piece.url) { timerRef.current = setTimeout(next, Math.max(0, (piece.endSeconds - piece.startSeconds) * 1000)); return; }
    const a = new Audio(piece.url);
    audioRef.current = a;
    a.onended = next;
    a.onerror = next;
    void a.play().catch(() => { if (run === runRef.current) { setPlaying(false); } });
  }

  function togglePlay() {
    if (playing) { stop(); return; }
    setPlaying(true);
    const run = ++runRef.current;
    playFrom(current, run);
  }

  if (isLoading) return <Center><p className="text-sm text-muted-foreground">Loading…</p></Center>;
  if (!data) return <Center><h1 className="font-display text-3xl">This recording isn't available</h1><p className="mt-2 text-sm text-muted-foreground">The link may be wrong, or the translation hasn't finished yet.</p></Center>;

  const total = pieces.length;
  const shown = pieces.slice(0, Math.max(current, 0) + 1);

  return (
    <div className="mx-auto max-w-2xl px-5 py-12">
      <div className="rounded-3xl border bg-card p-6 text-center shadow-card">
        <p className="text-xs text-muted-foreground">Recorded sermon</p>
        <h1 className="mt-2 font-display text-3xl">{data.title}</h1>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {data.languages.map((l) => (
            <button key={l} onClick={() => { stop(); setLang(l); setCurrent(0); }}
              className={`rounded-full border px-4 py-2 text-sm ${lang === l ? "border-foreground bg-foreground text-background" : "bg-background"}`}>{name(l)}</button>
          ))}
        </div>
        <button onClick={togglePlay} disabled={total === 0}
          className="mt-6 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {playing ? <><Pause className="size-4" /> Pause</> : <><Play className="size-4" /> Play in {name(lang ?? "")}</>}
        </button>
        <p className="mt-3 text-xs text-muted-foreground">{total === 0 ? "No audio for this language." : `Piece ${Math.min(current + 1, total)} of ${total}`}</p>
      </div>

      {shown.length > 0 && (
        <div className="mt-8 space-y-3">
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Headphones className="size-4" /> Text as it plays</p>
          {shown.slice(-5).map((p) => (
            <div key={p.index} className="rounded-2xl border bg-background p-4">
              <p className="text-sm text-muted-foreground">{p.english}</p>
              <p className="mt-1 font-display text-lg">{p.translation}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-[60vh] flex-col items-center justify-center px-5 text-center">{children}</div>;
}

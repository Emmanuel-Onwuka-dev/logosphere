import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Radio, Headphones, ArrowLeft, Loader2, WifiOff } from "lucide-react";
import { useListen } from "@/components/live/useListen";
import { supabase } from "@/integrations/supabase/client";
import { TARGET_LANGUAGES, STATUS_LABEL } from "@/lib/languages";

export const Route = createFileRoute("/s/$code")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Join live interpretation — Logosphere" },
      { name: "description", content: "Listen to this church service in your language on Logosphere." },
      { property: "og:title", content: "Join live interpretation — Logosphere" },
      { property: "og:description", content: "Pick your language and listen live." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: JoinPage,
});

type PublicSession = { title: string; church_name: string; status: "draft" | "live" | "paused" | "ended"; source_language: string; target_languages: string[] };

function JoinPage() {
  const { code } = Route.useParams();
  const [lang, setLang] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const { data: s, isLoading } = useQuery({
    queryKey: ["public-session", code],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_public_session", { _code: code });
      if (error) throw error;
      return ((data as PublicSession[])?.[0] ?? null) as PublicSession | null;
    },
    refetchInterval: 10000,
  });

  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    setOnline(navigator.onLine);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  return (
    <div className="min-h-[100dvh] bg-background px-5 pb-10">
      <header className="mx-auto flex max-w-md items-center justify-between py-5">
        <Link to="/" className="inline-flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-lg border-[1.5px] border-foreground"><Radio className="size-3.5" /></span>
          <span className="font-display text-lg">Logosphere</span>
        </Link>
        {!online && <span className="inline-flex items-center gap-1 text-xs text-destructive"><WifiOff className="size-3.5" /> Offline</span>}
      </header>
      <main className="mx-auto max-w-md">
        {isLoading ? <Center><Loader2 className="size-6 animate-spin" /></Center>
          : !s ? <Center><h1 className="font-display text-2xl">Session not found</h1><p className="mt-2 text-sm text-muted-foreground">Check the QR code or link and try again.</p></Center>
          : s.status === "ended" ? <Center><p className="text-sm text-muted-foreground">{s.church_name}</p><h1 className="mt-1 font-display text-2xl">{s.title}</h1><p className="mt-4 text-sm">This service has ended. Thank you for listening.</p></Center>
          : lang ? <Player code={code} s={s} lang={lang} online={online} onBack={() => setLang(null)} />
          : <Picker s={s} onPick={setLang} />}
      </main>
    </div>
  );
}

/** Supabase RPC calls are lazy: they only send once awaited/then'd. */
function rpc(name: string, args: Record<string, unknown>) {
  (supabase.rpc as any)(name, args).then(() => {}, () => {});
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="grid min-h-[60vh] place-items-center text-center"><div>{children}</div></div>;
}

function StatusPill({ status }: { status: PublicSession["status"] }) {
  const t = { draft: "Starting soon", live: "Live now", paused: "Paused", ended: "Ended" }[status];
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs ${status === "live" ? "bg-live text-primary-foreground" : "bg-secondary"}`}>{status === "live" && <span className="size-1.5 animate-pulse rounded-full bg-primary-foreground" />}{t}</span>;
}

function Picker({ s, onPick }: { s: PublicSession; onPick: (c: string) => void }) {
  const langs = TARGET_LANGUAGES.filter((l) => s.target_languages.includes(l.code));
  return (
    <div className="pt-4">
      <p className="text-sm text-muted-foreground">{s.church_name}</p>
      <h1 className="mt-1 font-display text-3xl leading-tight">{s.title}</h1>
      <div className="mt-3"><StatusPill status={s.status} /></div>
      <h2 className="mt-8 text-sm font-medium">Choose your language</h2>
      <ul className="mt-3 space-y-2.5">
        {langs.map((l) => (
          <li key={l.code}>
            <button onClick={() => onPick(l.code)} className="flex w-full items-center justify-between rounded-2xl border bg-card px-5 py-4 text-left shadow-card active:scale-[0.99]">
              <span><span className="block text-lg font-medium">{l.native}</span><span className="text-xs text-muted-foreground">{l.name}</span></span>
              <span className="text-[11px] text-muted-foreground">{STATUS_LABEL[l.status]}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-6 flex items-center gap-2 text-xs text-muted-foreground"><Headphones className="size-4" /> Use headphones so you don't disturb others.</p>
    </div>
  );
}

function Player({ code, s, lang, online, onBack }: { code: string; s: PublicSession; lang: string; online: boolean; onBack: () => void }) {
  const l = TARGET_LANGUAGES.find((x) => x.code === lang)!;
  const [conn, setConn] = useState<"joining" | "joined" | "error">("joining");
  const idRef = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    (supabase.rpc as any)("join_session", { _code: code, _language: lang }).then(({ data, error }: any) => {
      if (!alive) { if (data) rpc("leave_session", { _id: data }); return; }
      if (error) { setConn("error"); return; }
      idRef.current = data; setConn("joined");
    });
    const bye = () => { if (idRef.current) { rpc("leave_session", { _id: idRef.current }); idRef.current = null; } };
    window.addEventListener("pagehide", bye);
    const beat = setInterval(() => { if (idRef.current) rpc("listener_heartbeat", { _id: idRef.current }); }, 30000);
    return () => {
      alive = false; clearInterval(beat);
      if (idRef.current) rpc("leave_session", { _id: idRef.current });
      idRef.current = null; window.removeEventListener("pagehide", bye);
    };
  }, [code, lang]);

  // Interpreted channels publish as "interp-<lang>"; until an engine exists, listeners can hear the original voice.
  const [original, setOriginal] = useState(false);
  const audio = useListen(code, original ? "source" : `interp-${lang}`, online && conn === "joined");
  const state = !online ? "Reconnecting…" : conn === "joining" ? "Connecting…" : conn === "error" ? "Couldn't connect" :
    s.status === "draft" ? "Waiting for the service to start" : s.status === "paused" ? "Interpretation paused" :
    audio.state === "playing" ? (original ? "Playing original audio" : "Playing live") : audio.state === "blocked" ? "Tap to start audio" :
    audio.state === "error" ? "Live audio unavailable" : original ? "Waiting for the preacher's microphone" : "Waiting for interpreted audio";

  return (
    <div className="pt-2">
      <button onClick={onBack} className="inline-flex items-center gap-1 text-sm text-muted-foreground"><ArrowLeft className="size-4" /> Change language</button>
      <div className="mt-6 rounded-3xl border bg-card p-6 text-center shadow-card">
        <p className="text-xs text-muted-foreground">{s.church_name} · {s.title}</p>
        <h1 className="mt-3 font-display text-4xl">{l.native}</h1>
        <p className="text-sm text-muted-foreground">{l.name}</p>
        <div className="mt-4"><StatusPill status={s.status} /></div>
        <div className="mx-auto mt-8 flex h-16 items-end justify-center gap-1" aria-hidden>
          {Array.from({ length: 24 }).map((_, i) => (
            <span key={i} className="w-1.5 rounded-full bg-muted-foreground/30" style={{ height: `${20 + ((i * 37) % 60)}%` }} />
          ))}
        </div>
        <p className="mt-6 font-medium">{state}</p>
        {audio.state === "blocked" && <button onClick={audio.resume} className="mt-4 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground">Start listening</button>}
        <p className="mt-2 text-xs text-muted-foreground">Interpretation into {l.name} isn't connected yet. Keep this page open.</p>
        <button onClick={() => setOriginal((o) => !o)} className="mt-4 rounded-full border px-4 py-2 text-xs">{original ? `Back to ${l.name} channel` : "Listen to the original voice instead"}</button>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Volume2, Square } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { TARGET_LANGUAGES } from "@/lib/languages";
import { speakReplyToPreacher } from "@/lib/replies.functions";

type Reply = { id: string; language: string; original: string; english: string; created_at: string };

/**
 * Operator view: listeners' replies, in English, newest first. Each reply can be read aloud on this device.
 * Turn-taking: only one reply plays at a time, and nothing plays automatically, so the preacher's microphone
 * does not pick up the playback.
 */
export function SessionReplies({ sessionId }: { sessionId: string }) {
  const speak = useServerFn(speakReplyToPreacher);
  const { data = [] } = useQuery({
    queryKey: ["session-replies", sessionId],
    refetchInterval: 4000,
    queryFn: async (): Promise<Reply[]> => {
      const { data, error } = await (supabase as any).from("session_replies")
        .select("id, language, original, english, created_at").eq("session_id", sessionId)
        .order("created_at", { ascending: false }).limit(50);
      if (error) throw error;
      return (data ?? []) as Reply[];
    },
  });

  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const stop = () => {
    audioRef.current?.pause();
    audioRef.current = null;
    setPlayingId(null);
  };
  useEffect(() => () => stop(), []);

  async function play(r: Reply) {
    stop();
    setLoadingId(r.id);
    try {
      const out = await speak({ data: { replyId: r.id } });
      const bytes = Uint8Array.from(atob(out.audioBase64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: out.mimeType }));
      const audio = new Audio(url);
      audioRef.current = audio;
      setPlayingId(r.id);
      audio.onended = () => { URL.revokeObjectURL(url); setPlayingId(null); audioRef.current = null; };
      audio.onerror = () => { setPlayingId(null); toast.error("Could not play this reply"); };
      await audio.play();
    } catch (e) {
      setPlayingId(null);
      toast.error(e instanceof Error ? e.message : "Could not read this reply aloud");
    } finally {
      setLoadingId(null);
    }
  }

  const busy = playingId !== null || loadingId !== null;

  return (
    <section className="rounded-3xl border bg-card p-6 shadow-card">
      <h2 className="font-display text-xl">Listener replies</h2>
      <p className="mt-1 text-xs text-muted-foreground">What listeners say to you, translated into English. Read one aloud on this device; one at a time.</p>
      {data.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">No replies yet.</p>
      ) : (
        <ul className="mt-4 divide-y">
          {data.map((r) => (
            <li key={r.id} className="flex items-start justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">{TARGET_LANGUAGES.find((l) => l.code === r.language)?.name ?? r.language} · {new Date(r.created_at).toLocaleTimeString()}</p>
                <p className="mt-1 font-display text-lg">{r.english}</p>
                <p className="mt-1 text-sm text-muted-foreground">Original: {r.original}</p>
              </div>
              {playingId === r.id ? (
                <button onClick={stop} className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-2 text-sm"><Square className="size-3.5" /> Stop</button>
              ) : (
                <button onClick={() => play(r)} disabled={busy} className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-2 text-sm disabled:opacity-50">
                  {loadingId === r.id ? <Loader2 className="size-3.5 animate-spin" /> : <Volume2 className="size-3.5" />} Read aloud
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { TARGET_LANGUAGES } from "@/lib/languages";

type Reply = { id: string; language: string; original: string; english: string; created_at: string };

/** Operator view: what listeners said, as text. The preacher reads it; nothing is spoken aloud. */
export function SessionReplies({ sessionId }: { sessionId: string }) {
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

  return (
    <section className="rounded-3xl border bg-card p-6 shadow-card">
      <h2 className="font-display text-xl">Listener replies</h2>
      <p className="mt-1 text-xs text-muted-foreground">What listeners said, as text. Translated into English, newest first.</p>
      {data.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">No replies yet.</p>
      ) : (
        <ul className="mt-4 divide-y">
          {data.map((r) => (
            <li key={r.id} className="py-3">
              <p className="text-xs text-muted-foreground">{TARGET_LANGUAGES.find((l) => l.code === r.language)?.name ?? r.language} · {new Date(r.created_at).toLocaleTimeString()}</p>
              <p className="mt-1 font-display text-lg">{r.english}</p>
              <p className="mt-1 text-sm text-muted-foreground">Original: {r.original}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

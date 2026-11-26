import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Send, Loader2 } from "lucide-react";
import { replyFromListener, REPLY_MAX_CHARACTERS } from "@/lib/replies.functions";
import { TARGET_LANGUAGES } from "@/lib/languages";

type Sent = { original: string; english: string };

/**
 * Listener comments, like a live chat: the listener types a message in their language and the preacher sees it
 * in English. Text only; nothing is recorded or spoken.
 */
export function ListenerReply({ code, language, live }: { code: string; language: string; live: boolean }) {
  const send = useServerFn(replyFromListener);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent[]>([]);
  const langName = TARGET_LANGUAGES.find((l) => l.code === language)?.name ?? language;

  if (!live) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const message = text.trim();
    if (!message || busy) return;
    setBusy(true); setError(null);
    try {
      const out = await send({ data: { code, language: language as "fr" | "es", text: message } });
      setSent((all) => [out, ...all]);
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Your message could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 rounded-3xl border bg-card p-6 text-left shadow-card">
      <p className="font-medium">Send a message to the preacher</p>
      <p className="mt-1 text-xs text-muted-foreground">Write in {langName}. The preacher reads it in English. Up to {REPLY_MAX_CHARACTERS} characters.</p>

      <form onSubmit={submit} className="mt-4 flex flex-col gap-3 sm:flex-row">
        <label className="sr-only" htmlFor="listener-message">Your message in {langName}</label>
        <textarea
          id="listener-message"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={REPLY_MAX_CHARACTERS}
          rows={2}
          disabled={busy}
          placeholder={`Write in ${langName}…`}
          className="min-h-[3rem] flex-1 rounded-xl border bg-background px-3 py-2 text-sm"
        />
        <button type="submit" disabled={busy || !text.trim()} className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Send
        </button>
      </form>

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

      {sent.length > 0 && (
        <ul className="mt-5 space-y-3">
          {sent.map((m, i) => (
            <li key={i} className="rounded-2xl bg-background p-4 text-sm">
              <p>{m.original}</p>
              <p className="mt-1 text-xs text-muted-foreground">Sent to the preacher as: {m.english}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

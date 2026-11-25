const API = "https://api.assemblyai.com/v2";
const POLL_MS = 1500;
const MAX_WAIT_MS = 60_000;

/**
 * Transcribes one short clip (a listener's reply) with AssemblyAI in the language the listener speaks.
 * Upload → request transcript → poll until complete. The key never leaves the server.
 */
export async function transcribeWithAssemblyAI(audio: Uint8Array, language: "fr" | "es", key: string): Promise<string> {
  const upload = await fetch(`${API}/upload`, {
    method: "POST",
    headers: { authorization: key, "content-type": "application/octet-stream" },
    body: new Blob([audio as BlobPart], { type: "application/octet-stream" }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!upload.ok) throw new Error(`AssemblyAI upload failed (HTTP ${upload.status}); check the key and account balance`);
  const { upload_url } = (await upload.json()) as { upload_url: string };

  const submit = await fetch(`${API}/transcript`, {
    method: "POST",
    headers: { authorization: key, "content-type": "application/json" },
    body: JSON.stringify({ audio_url: upload_url, language_code: language }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!submit.ok) throw new Error(`AssemblyAI could not start the transcript (HTTP ${submit.status})`);
  const { id } = (await submit.json()) as { id: string };

  const started = Date.now();
  while (Date.now() - started < MAX_WAIT_MS) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const poll = await fetch(`${API}/transcript/${id}`, { headers: { authorization: key }, signal: AbortSignal.timeout(15_000) });
    if (!poll.ok) throw new Error(`AssemblyAI status check failed (HTTP ${poll.status})`);
    const body = (await poll.json()) as { status: string; text?: string | null; error?: string | null };
    if (body.status === "completed") return (body.text ?? "").trim();
    if (body.status === "error") throw new Error(`AssemblyAI could not transcribe: ${body.error ?? "unknown error"}`);
  }
  throw new Error("The transcript took too long. Please try again.");
}

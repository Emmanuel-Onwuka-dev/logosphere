# Logosphere — Handoff for local development

## a. Lovable Cloud / Lovable-only services
- **Lovable Cloud: not used.** The database and auth are your own external Supabase project.
- **Lovable AI Gateway** (`@lovable.dev/ai-gateway`) — the translation step (`src/lib/translate.ts`). Lovable-only.
- **`@lovable.dev/vite-tanstack-config`** — build config wrapper in `vite.config.ts`. Public npm package, works outside Lovable.
- **`src/integrations/supabase/previewAuthStorage.ts`** — auth storage helper for the Lovable preview; falls back to normal browser storage elsewhere.
- Hosting/publishing (Cloudflare Workers) is done by Lovable today.

## b. Backend
Server functions (`createServerFn`, all require a signed-in user unless noted):
| Function | File | Calls |
|---|---|---|
| getBroadcastToken | src/lib/livekit.functions.ts | Supabase (session + role check), LiveKit (mints publish token) |
| getListenToken (public) | src/lib/livekit.functions.ts | Supabase `get_public_session`, LiveKit (subscribe token) |
| transcribeDeepgram (platform admin) | src/lib/deepgram.functions.ts | Supabase role check, Deepgram speech-to-text |
| translateDeepgramText (platform admin) | src/lib/deepgram.functions.ts | Supabase role check, translation model |
| speakDeepgram (platform admin) | src/lib/deepgram.functions.ts | Supabase role check, Deepgram text-to-speech |
| interpretPiece (platform admin) | src/lib/deepgram.functions.ts | Supabase, Deepgram STT → translation model → Deepgram TTS |
| interpretLivePiece (church operator) | src/lib/deepgram.functions.ts | Supabase (role check; writes `channel_status` with service key), Deepgram, translation model |
| testEndpoint (platform admin) | src/lib/engines.functions.ts | Supabase, Deepgram health or Intron TTS health or generic endpoint |
| runPlayground (platform admin) | src/lib/engines.functions.ts | Supabase, Intron STT/TTS + translation model, or generic endpoint |

API route:
| Route | File | Calls |
|---|---|---|
| POST /api/public/worker (bearer WORKER_TOKEN; actions jobs/token/status) | src/routes/api/public/worker.ts | Supabase via service key, LiveKit |

## c. Supabase project
Ours (external, owned by you, not Lovable's). Variables: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`, `DB_SERVICE_KEY`. Migrations: `supabase/migrations/`.

## d. Translation model
`openai/gpt-6.1-terra` through the Lovable AI Gateway, using `LOVABLE_API_KEY`. That key is issued by Lovable and billed to Lovable credits; it can technically be set outside Lovable, but it is tied to the Lovable project. For independence, replace `translateText` with a direct provider (OpenAI, Google, DeepL) and its own key.

## e. Environment variables for local dev (copy `.env.example` to `.env.local`; `.env` is tracked by Lovable and contains only public Supabase values)
- `SUPABASE_URL` — Supabase project address (server).
- `SUPABASE_PUBLISHABLE_KEY` — Supabase public key (server).
- `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` / `VITE_SUPABASE_PROJECT_ID` — same values for the browser.
- `DB_SERVICE_KEY` — Supabase service-role key; worker API and live channel status only.
- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` — LiveKit server and credentials.
- `WORKER_TOKEN` — shared bearer key for GPU workers.
- `DEEPGRAM_API_KEY` — Deepgram speech-to-text and voices.
- `LOVABLE_API_KEY` — translation model via Lovable AI Gateway.
- `ENGINE_INTRON_API_KEY` — Intron (paused; only for the Intron endpoint).

Note: `src/integrations/supabase/client.ts` currently hard-codes the public Supabase URL and publishable key (public values, not secrets).

## f. What would stop it working outside Lovable
1. **Translation via Lovable AI Gateway** → swap `src/lib/translate.ts` to a direct provider SDK + own key.
2. **Hosting** → deploy to your own Cloudflare Workers account (`wrangler`) or adapt the TanStack Start target (Node/Vercel/Netlify).
3. **Secrets live in Lovable** → re-create every variable in section e in `.env` and in your host.
4. **Supabase auth redirect URLs** → add `http://localhost:8080/auth` and your new domain in Supabase → Auth → URL Configuration; update Google OAuth redirect too.
5. **Preview auth storage helper** → harmless outside Lovable; can be replaced with default `localStorage`.
6. **Build config package** → keeps working; can be replaced by a plain Vite + TanStack Start config if desired.

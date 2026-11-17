# Logosphere — Handover Documentation

Real-time multilingual church interpretation. One preacher's voice is interpreted live and sent to congregants' phones.

## 1. Architecture

```text
Preacher mic --(LiveKit track "source")--> LiveKit room ls-<public_code>
                                              |            ^
                     GPU worker subscribes ---+            | publishes "interp-<lang>"
                                              v            |
                                   Congregant phones (subscribe to one track)
App (TanStack Start on edge workers) <-> Supabase (auth, data, realtime)
GPU worker <-> /api/public/worker (jobs, tokens, status)
```
Audio never goes through the database. The app doesn't depend on any one model or GPU provider: workers find their jobs through the engine registry.

## 2. Frontend structure
- `src/routes/index.tsx`: public website. `auth.tsx`: sign in and sign up.
- `src/routes/_authenticated/`: signed-in area (pages here need a login). `dashboard.tsx`: church and sessions. `sessions.$id.tsx`: live control, QR code, channels. `control.tsx`: AI Engine Control Centre. `playground.tsx`: Model Playground.
- `src/routes/s.$code.tsx`: congregant listening page, no account needed.
- `src/components/live/`: Broadcaster (publishes the mic) and useListen (playback).
- `src/lib/`: `languages.ts`, `sessions.ts`, `livekit.functions.ts`, `engines.functions.ts`.
- `src/routes/api/public/worker.ts`: GPU worker API.

## 3. Supabase configuration
- This is an external Supabase project. Migrations live in `supabase/migrations/`.
- Auth: Email + password with email confirmation, plus Google OAuth.
- URL Configuration: add the preview address and the published address, each with `/auth`, to Site URL and Redirect URLs.
- Realtime is on for `sessions`, `listener_connections` and `channel_status`.

## 4. Database schema
| Table | Purpose |
|---|---|
| churches | Church accounts |
| profiles | Display name, church |
| user_roles | Roles (optionally per church) |
| sessions | Interpretation sessions: languages, status, public_code, timings |
| listener_connections | One row per listening phone; heartbeat and left_at |
| channel_status | Per-language engine status reported by workers |
| ai_providers / ai_engines / inference_endpoints / engine_assignments / endpoint_checks | Engine registry (platform admin only) |
| playground_runs | Model Playground results and ratings |

Public RPCs that listeners can call: `get_public_session`, `join_session`, `listener_heartbeat`, `leave_session`.

## 5. Authentication and roles
Roles are `platform_admin`, `church_admin`, `media_operator` and `listener`, stored in `user_roles` and never on profiles. Access is checked with the security-definer functions `has_role`, `has_church_role`, `is_church_member` and `can_operate_church`. RLS isolates each church's data. Every new user automatically gets a profile and the `listener` role. `create_church` makes the caller that church's church_admin.

## 6. LiveKit
Room `ls-<public_code>`. The preacher publishes `source`; interpreted channels use `interp-<lang>`. Tokens are minted server-side only: broadcast tokens for church operators, subscribe-only tokens for listeners.

## 7. GPU inference integration
See `docs/worker-api.md`. Workers poll `jobs`, request a room `token`, subscribe to `source`, run their model, publish `interp-<lang>` and report `status`. Model and provider logic lives in the worker (an independent adapter).

## 8. AI engine registration
Control Centre, in this order: Provider → Engine (model, type, languages, streaming) → Inference endpoint (URL, health check URL, auth method, **secret name**) → Assignment (source → target language, mode, priority).

## 9. Environment variables (server secrets)
| Name | Use |
|---|---|
| SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY | Supabase access |
| DB_SERVICE_KEY | Service-role key, used only by the worker API |
| LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET | LiveKit |
| WORKER_TOKEN | Bearer token for GPU workers |
| ENGINE_* | Per-endpoint API keys, referenced by name in inference_endpoints.secret_ref |

## 10. API contracts
- `POST /api/public/worker` with `Authorization: Bearer WORKER_TOKEN`, actions `jobs`, `token` and `status`. Details are in docs/worker-api.md.
- Playground and endpoint tests send a JSON POST `{audio_base64, mime_type, source_language, target_language, model_id}`. They expect either an audio body, or JSON with `audio_base64` and/or `text`/`transcript`.

## 11. How-tos
- **Add an AI provider:** register it in the Control Centre, add an `ENGINE_<NAME>` secret, create the endpoint with that secret name, then Test.
- **Add a language:** add an entry to `TARGET_LANGUAGES` in `src/lib/languages.ts` (status must reflect real readiness), then add an engine assignment.
- **Change a language's engine:** edit or reprioritise its row under Assignments. No rebuild is needed; workers pick it up on their next poll.
- **Test a new GPU endpoint:** press Test in Control Centre → Inference endpoints, then compare outputs in the Model Playground.
- **Run locally:** `bun install`, then `bun run dev`. Tests: `bun run test`.
- **Deploy:** publish from Lovable, then add the published URL to the Supabase redirect URLs.

## 12. Integration status
| Item | Status |
|---|---|
| Public website, auth (email + Google), roles, church isolation | Implemented and tested |
| Dashboard, sessions, QR codes, listener counts | Implemented and tested |
| Congregant page, original-voice audio over LiveKit | Implemented and tested on phones |
| Engine registry, endpoint tests, Model Playground | Implemented; no real engine registered yet |
| Worker API (jobs/token/status) | Implemented and configured; no worker connected |
| GPU interpretation worker (SeamlessStreaming; ASR→MT→TTS for ig/yo/ha) | **Pending**: must be built outside the app |
| Live interpreted audio in any language | **Pending**: needs a worker |

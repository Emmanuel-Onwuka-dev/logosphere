# Logosphere interpretation worker API

Workers run on your GPU servers (outside this app). Each worker joins a LiveKit room,
listens to the preacher's `source` track, runs its model, and publishes the result
as `interp-<lang>`. All calls: `POST https://<your-site>/api/public/worker`,
header `Authorization: Bearer <WORKER_TOKEN>`, JSON body.

| action | body | returns |
|---|---|---|
| `jobs` | `{ "action": "jobs" }` | `{ jobs: [{ session_id, room, session_status, source_language, target_language, input_track, output_track, engine \| null }] }` — engine comes from Control Centre assignments (only enabled ones); endpoints list a `secret_name`, never the key. |
| `token` | `{ "action": "token", session_id, language, worker_id }` | `{ url, token, room, input_track, output_track }` — LiveKit token that may subscribe and publish. |
| `status` | `{ "action": "status", session_id, language, status: waiting\|running\|error\|stopped, error?, latency_ms?, worker_id?, engine_id? }` | `{ ok: true }` — shown live on the session page. |

## Loop
1. Poll `jobs` every ~5 s. Start a task for each job whose `engine` you serve; stop tasks for jobs that disappear.
2. For a task: call `token`, connect with the LiveKit SDK, subscribe to `input_track`.
3. Direct mode (e.g. SeamlessStreaming): stream audio frames into the model, publish output frames to `output_track`.
   Cascaded mode (Igbo/Yoruba/Hausa): ASR → translation → TTS, then publish.
4. While `session_status` is `paused`, keep the connection but stop publishing.
5. Report `status` on start, on errors, and every ~30 s with `latency_ms`.

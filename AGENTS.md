<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

## What Lovable manages

Rules outside this block are the project's own. Change the pieces below in
Lovable, not by hand. With the [Lovable MCP](https://mcp.lovable.dev)
connected, `send_message` asks Lovable to do it; otherwise ask the user to
use the editor.

- **Database.** Do not add or edit `supabase/migrations/` or `drizzle/`.
  Ask Lovable to change the schema.
- **Generated files.** Do not edit a file whose header says it is automatically
  generated.
- **AI gateway.** Keep model calls on Lovable's gateway, and keep
  `LOVABLE_API_KEY` out of browser code.
- **Connectors.** Lovable provides native connectors. `list_connectors` shows
  which are enabled; `add_connector` only returns the dashboard link. When a
  connector is enabled, calls go through the connector gateway and need
  `LOVABLE_API_KEY`. When Lovable does not provide one, users can bring their
  own key and store it in Secrets.
- **Secrets.** Lovable manages them. Do not put secret values in the repo.
<!-- LOVABLE:END -->

## Project rules
- Language list and per-language status live in `src/lib/languages.ts`; status must reflect real engine readiness (never mark a language available without a verified engine).
- Roles live in `public.user_roles` (optionally scoped by church_id), checked via security-definer `has_role`/`has_church_role`; never store roles on profiles — prevents privilege escalation.
- App data is read from the browser Supabase client under RLS; signed-in pages live under `src/routes/_authenticated/`.
- AI engine registry (providers, engines, endpoints, assignments, checks) is platform-admin-only via RLS; endpoints store only a secret *name* (ENGINE_* prefix) resolved server-side in `src/lib/engines.functions.ts` — raw keys never live in tables.
- Live audio rooms via LiveKit; tokens minted server-side in src/lib/livekit.functions.ts (secrets never reach browser); preacher publishes track "source", interpreted channels use "interp-<lang>".
- GPU interpretation workers integrate only via `/api/public/worker` (bearer WORKER_TOKEN, contract in docs/worker-api.md); model/provider logic lives in workers, keeping the app engine-agnostic.
- Before publishing (or whenever the user raises publishing), remind him that WORKER_TOKEN is one shared, never-expiring key — anyone given it keeps access forever — and offer per-worker keys, an address allowlist, or an expiry date. He chose to leave it as-is on 2026-11-17, so do not change the code unless he asks.

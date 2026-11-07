import { createFileRoute } from "@tanstack/react-router";
import { AccessToken } from "livekit-server-sdk";

/**
 * Interpretation worker API (see docs/worker-api.md). GPU workers call this with
 * `Authorization: Bearer <WORKER_TOKEN>`. Provider-specific model handling lives in the worker, not here.
 */
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

function safeEq(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
const STATUSES = ["waiting", "running", "error", "stopped"];

export const Route = createFileRoute("/api/public/worker")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env["WORKER_TOKEN"];
        const got = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
        if (!expected || expected.length < 24 || !safeEq(got, expected)) return json({ error: "Unauthorized" }, 401);
        let body: any; try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
        const { workerDb } = await import("@/lib/worker-db.server");
        const sb = workerDb() as any;

        if (body.action === "jobs") {
          const { data: sessions, error } = await sb.from("sessions").select("id, public_code, source_language, target_languages, status").in("status", ["live", "paused"]);
          if (error) return json({ error: "Could not load sessions" }, 500);
          const { data: asg } = await sb.from("engine_assignments")
            .select("source_language, target_language, processing_mode, priority, engine_id, ai_engines(engine_name, model_id, engine_type, streaming, status, inference_endpoints(id, endpoint_url, websocket_url, auth_method, secret_ref, status))")
            .eq("enabled", true).order("priority");
          const jobs = (sessions ?? []).flatMap((s: any) => s.target_languages.filter((l: string) => l !== s.source_language).map((lang: string) => {
            const a = (asg ?? []).find((x: any) => x.source_language === s.source_language && x.target_language === lang);
            return {
              session_id: s.id, room: `ls-${s.public_code}`, session_status: s.status,
              source_language: s.source_language, target_language: lang, input_track: "source", output_track: `interp-${lang}`,
              engine: a ? { id: a.engine_id, name: a.ai_engines?.engine_name, model_id: a.ai_engines?.model_id, type: a.ai_engines?.engine_type, processing_mode: a.processing_mode, streaming: a.ai_engines?.streaming,
                endpoints: (a.ai_engines?.inference_endpoints ?? []).map((e: any) => ({ id: e.id, url: e.endpoint_url, websocket_url: e.websocket_url, auth_method: e.auth_method, secret_name: e.secret_ref })) } : null,
            };
          }));
          return json({ jobs });
        }

        if (body.action === "token") {
          const { session_id, language, worker_id } = body;
          if (typeof session_id !== "string" || typeof language !== "string" || !/^[a-z]{2,3}$/.test(language)) return json({ error: "session_id and language required" }, 400);
          const { data: s } = await sb.from("sessions").select("public_code, status, target_languages").eq("id", session_id).maybeSingle();
          if (!s || s.status === "ended" || !s.target_languages.includes(language)) return json({ error: "Channel not active" }, 404);
          const key = process.env["LIVEKIT_API_KEY"], secret = process.env["LIVEKIT_API_SECRET"];
          if (!key || !secret) return json({ error: "Live audio not configured" }, 500);
          const at = new AccessToken(key, secret, { identity: `worker-${language}-${String(worker_id ?? "w").slice(0, 40)}`, ttl: "6h" });
          at.addGrant({ room: `ls-${s.public_code}`, roomJoin: true, canSubscribe: true, canPublish: true, canPublishData: false });
          return json({ url: process.env["LIVEKIT_URL"], token: await at.toJwt(), room: `ls-${s.public_code}`, input_track: "source", output_track: `interp-${language}` });
        }

        if (body.action === "status") {
          const { session_id, language, status, error, latency_ms, worker_id, engine_id } = body;
          if (typeof session_id !== "string" || typeof language !== "string" || !STATUSES.includes(status)) return json({ error: "session_id, language, status required" }, 400);
          const { error: e } = await sb.from("channel_status").upsert({
            session_id, language, status,
            last_error: typeof error === "string" ? error.slice(0, 1000) : null,
            latency_ms: Number.isFinite(latency_ms) ? Math.round(latency_ms) : null,
            worker_id: typeof worker_id === "string" ? worker_id.slice(0, 80) : null,
            engine_id: typeof engine_id === "string" ? engine_id : null,
          }, { onConflict: "session_id,language" });
          if (e) return json({ error: "Could not save status" }, 500);
          return json({ ok: true });
        }
        return json({ error: "Unknown action" }, 400);
      },
    },
  },
});

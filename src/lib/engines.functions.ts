import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { INTRON_BASE, isIntronEndpoint, intronHealthCheck, runIntronPipeline } from "@/lib/intron";
import { translateText } from "@/lib/translate";

/** Secrets used by engines must be stored as server secrets named ENGINE_*. */
export const SECRET_PREFIX = "ENGINE_";

export const testEndpoint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { endpointId: string }) => d)
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { data: isAdmin } = await sb.rpc("has_role", { _user_id: context.userId, _role: "platform_admin" });
    if (!isAdmin) throw new Error("Forbidden");
    const { data: ep, error } = await (sb as any).from("inference_endpoints")
      .select("id, endpoint_url, healthcheck_url, auth_method, secret_ref, ai_engines(timeout_ms, supported_language_pairs)")
      .eq("id", data.endpointId).single();
    if (error || !ep) throw new Error("Endpoint not found");

    // Intron has no plain "is it up" address — ask it to speak one word instead.
    if (isIntronEndpoint(ep.endpoint_url)) {
      const ref: string | null = ep.secret_ref;
      const secret = ref && ref.startsWith(SECRET_PREFIX) ? process.env[ref] : undefined;
      const target = String(ep.ai_engines?.supported_language_pairs?.[0] ?? "").split("-").pop() ?? "ha";
      const t0 = Date.now();
      const check = secret
        ? await intronHealthCheck({ base: INTRON_BASE, key: secret, language: target, timeoutMs: ep.ai_engines?.timeout_ms ?? 30000 })
        : { ok: false, status_code: null, error: `Secret ${ref ?? "(none)"} is not set on the server` };
      const latency_ms = Date.now() - t0;
      await (sb as any).from("endpoint_checks").insert({ endpoint_id: ep.id, ok: check.ok, status_code: check.status_code, latency_ms, error: check.error });
      await (sb as any).from("inference_endpoints").update({
        status: check.ok ? "healthy" : "unreachable", last_checked_at: new Date().toISOString(), last_latency_ms: latency_ms, last_error: check.error,
      }).eq("id", ep.id);
      return { ok: check.ok, status_code: check.status_code, latency_ms, error: check.error };
    }
    const url: string | null = ep.healthcheck_url || ep.endpoint_url;
    let ok = false, status_code: number | null = null, err: string | null = null;
    const t0 = Date.now();
    if (!url || !/^https?:\/\//.test(url)) err = "No valid health-check or base URL";
    else {
      const headers: Record<string, string> = {};
      if (ep.auth_method !== "none") {
        const ref: string | null = ep.secret_ref;
        const secret = ref && ref.startsWith(SECRET_PREFIX) ? process.env[ref] : undefined;
        if (!secret) err = `Secret ${ref ?? "(none)"} is not set on the server`;
        else if (ep.auth_method === "bearer") headers["Authorization"] = `Bearer ${secret}`;
        else headers["x-api-key"] = secret;
      }
      if (!err) {
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), ep.ai_engines?.timeout_ms ?? 10000);
          const res = await fetch(url, { headers, signal: ctrl.signal });
          clearTimeout(timer);
          status_code = res.status; ok = res.ok;
          if (!ok) err = `HTTP ${res.status}`;
        } catch (e) { err = e instanceof Error && e.name === "AbortError" ? "Timed out" : "Could not reach endpoint"; }
      }
    }
    const latency_ms = Date.now() - t0;
    await (sb as any).from("endpoint_checks").insert({ endpoint_id: ep.id, ok, status_code, latency_ms: url ? latency_ms : null, error: err });
    await (sb as any).from("inference_endpoints").update({
      status: ok ? "healthy" : "unreachable", last_checked_at: new Date().toISOString(), last_latency_ms: latency_ms, last_error: err,
    }).eq("id", ep.id);
    return { ok, status_code, latency_ms, error: err };
  });

type RunInput = { endpointIds: string[]; audioBase64: string; mimeType: string; inputName: string; sourceLanguage: string; targetLanguage: string };

/** Sends one audio clip to each chosen endpoint (Logosphere JSON contract), measures latency, saves results. */
export const runPlayground = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: RunInput) => {
    if (!Array.isArray(d.endpointIds) || d.endpointIds.length < 1 || d.endpointIds.length > 4) throw new Error("Pick 1–4 endpoints");
    if (typeof d.audioBase64 !== "string" || d.audioBase64.length > 14_000_000) throw new Error("Audio must be under 10 MB");
    return d;
  })
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "platform_admin" });
    if (!isAdmin) throw new Error("Forbidden");
    const { data: eps, error } = await sb.from("inference_endpoints")
      .select("id, endpoint_name, endpoint_url, auth_method, secret_ref, engine_id, ai_engines(engine_name, model_id, timeout_ms)")
      .in("id", data.endpointIds);
    if (error) throw new Error("Could not load endpoints");
    const batch_id = crypto.randomUUID();
    const input_bytes = Math.floor((data.audioBase64.length * 3) / 4);
    const results = await Promise.all((eps ?? []).map(async (ep: any) => {
      let ok = false, status_code: number | null = null, err: string | null = null;
      let output_kind: string | null = null, output_text: string | null = null, audio: string | null = null, audioMime: string | null = null;
      let transcript: string | null = null;
      const intron = isIntronEndpoint(ep.endpoint_url);
      const headers: Record<string, string> = { "content-type": "application/json" };
      let epSecret: string | null = null;
      if (ep.auth_method !== "none") {
        const ref: string | null = ep.secret_ref;
        const secret = ref && ref.startsWith(SECRET_PREFIX) ? process.env[ref] : undefined;
        if (!secret) err = `Secret ${ref ?? "(none)"} is not set on the server`;
        else {
          epSecret = secret;
          if (ep.auth_method === "bearer") headers["Authorization"] = `Bearer ${secret}`;
          else headers["x-api-key"] = secret;
        }
      }
      if (!err && !(ep.endpoint_url && /^https?:\/\//.test(ep.endpoint_url))) err = "Endpoint has no valid API URL";
      const t0 = Date.now();
      if (intron && !err) {
        try {
          const out = await runIntronPipeline({
            audioBase64: data.audioBase64, mimeType: data.mimeType,
            sourceLanguage: data.sourceLanguage, targetLanguage: data.targetLanguage,
            secret: epSecret ?? "", timeoutMs: Math.max(ep.ai_engines?.timeout_ms ?? 60000, 60000),
            translate: translateText,
          });
          ok = true; status_code = 200; output_kind = "audio+text";
          output_text = out.translated; transcript = out.transcript;
          audio = out.audioBase64; audioMime = out.audioMime;
        } catch (e) { err = e instanceof Error ? e.message : "Intron pipeline failed"; }
      } else if (!err) {
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), Math.max(ep.ai_engines?.timeout_ms ?? 30000, 30000));
          const res = await fetch(ep.endpoint_url, { method: "POST", headers, signal: ctrl.signal, body: JSON.stringify({
            audio_base64: data.audioBase64, mime_type: data.mimeType,
            source_language: data.sourceLanguage, target_language: data.targetLanguage, model_id: ep.ai_engines?.model_id ?? null,
          }) });
          clearTimeout(timer);
          status_code = res.status; ok = res.ok;
          const ct = res.headers.get("content-type") ?? "";
          if (ct.startsWith("audio/")) {
            const buf = new Uint8Array(await res.arrayBuffer());
            let s = ""; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
            audio = btoa(s); audioMime = ct; output_kind = "audio";
          } else if (ct.includes("json")) {
            const j: any = await res.json().catch(() => ({}));
            if (typeof j.audio_base64 === "string") { audio = j.audio_base64; audioMime = j.mime_type ?? "audio/wav"; }
            output_text = j.text ?? j.translation ?? j.transcript ?? null;
            output_kind = audio && output_text ? "audio+text" : audio ? "audio" : output_text ? "text" : "json";
          } else { output_text = (await res.text()).slice(0, 2000); output_kind = "text"; }
          if (!ok) err = `HTTP ${res.status}`;
        } catch (e) { err = e instanceof Error && e.name === "AbortError" ? "Timed out" : "Could not reach endpoint"; }
      }
      const latency_ms = err && status_code == null ? null : Date.now() - t0;
      const { data: row } = await sb.from("playground_runs").insert({
        created_by: context.userId, endpoint_id: ep.id, engine_id: ep.engine_id, batch_id,
        source_language: data.sourceLanguage, target_language: data.targetLanguage,
        input_name: data.inputName.slice(0, 200), input_bytes, ok, status_code, latency_ms, output_kind,
        output_text: output_text?.slice(0, 5000) ?? null, error: err,
        notes: transcript ? `Heard: ${transcript}`.slice(0, 2000) : null,
      }).select("id").single();
      return { runId: row?.id ?? null, endpointId: ep.id, endpointName: ep.endpoint_name, engineName: ep.ai_engines?.engine_name ?? "", ok, status_code, latency_ms, error: err, output_kind, output_text, audio, audioMime, transcript };
    }));
    return { batch_id, results };
  });

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
      .select("id, endpoint_url, healthcheck_url, auth_method, secret_ref, ai_engines(timeout_ms)")
      .eq("id", data.endpointId).single();
    if (error || !ep) throw new Error("Endpoint not found");
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

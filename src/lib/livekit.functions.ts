import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { AccessToken } from "livekit-server-sdk";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Track name the preacher's original microphone audio is published under. */
export const SOURCE_TRACK = "source";
const roomFor = (code: string) => `ls-${code}`;

function lk() {
  const url = process.env["LIVEKIT_URL"], key = process.env["LIVEKIT_API_KEY"], secret = process.env["LIVEKIT_API_SECRET"];
  if (!url || !key || !secret) throw new Error("Live audio is not configured");
  return { url, key, secret };
}

/** Church admins / media operators of the session's church may publish the preacher's microphone. */
export const getBroadcastToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { sessionId: string }) => d)
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    const { data: s } = await sb.from("sessions").select("id, church_id, public_code, status").eq("id", data.sessionId).maybeSingle();
    if (!s) throw new Error("Session not found");
    if (s.status === "ended") throw new Error("Session has ended");
    const checks = await Promise.all([
      sb.rpc("has_church_role", { _user_id: context.userId, _church_id: s.church_id, _role: "church_admin" }),
      sb.rpc("has_church_role", { _user_id: context.userId, _church_id: s.church_id, _role: "media_operator" }),
      sb.rpc("has_role", { _user_id: context.userId, _role: "platform_admin" }),
    ]);
    if (!checks.some((c: any) => c.data === true)) throw new Error("Forbidden");
    const { url, key, secret } = lk();
    const at = new AccessToken(key, secret, { identity: `op-${context.userId}`, ttl: "6h" });
    at.addGrant({ room: roomFor(s.public_code), roomJoin: true, canPublish: true, canSubscribe: false, canPublishData: false });
    return { url, token: await at.toJwt() };
  });

/** Public: anyone with the session link may listen (subscribe only) while it's not ended. */
export const getListenToken = createServerFn({ method: "POST" })
  .inputValidator((d: { code: string }) => {
    if (typeof d.code !== "string" || !/^[A-Za-z0-9_-]{3,32}$/.test(d.code)) throw new Error("Invalid code");
    return d;
  })
  .handler(async ({ data }) => {
    const key0 = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
    const pub = createClient(process.env["SUPABASE_URL"]!, key0, {
      auth: { persistSession: false },
      global: { fetch: (input, init) => {
        const h = new Headers(init?.headers);
        if (key0.startsWith("sb_") && h.get("Authorization") === `Bearer ${key0}`) h.delete("Authorization");
        h.set("apikey", key0);
        return fetch(input, { ...init, headers: h });
      } },
    });
    const { data: rows } = await (pub.rpc as any)("get_public_session", { _code: data.code });
    const s = rows?.[0];
    if (!s || s.status === "ended") throw new Error("Session not available");
    const { url, key, secret } = lk();
    const at = new AccessToken(key, secret, { identity: `l-${crypto.randomUUID()}`, ttl: "6h" });
    at.addGrant({ room: roomFor(data.code), roomJoin: true, canPublish: false, canSubscribe: true, canPublishData: false });
    return { url, token: await at.toJwt() };
  });

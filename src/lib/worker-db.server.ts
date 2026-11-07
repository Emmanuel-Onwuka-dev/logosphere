import { createClient } from "@supabase/supabase-js";

/** Privileged DB client for the worker API only (service key stored as DB_SERVICE_KEY). */
export function workerDb() {
  const url = process.env["SUPABASE_URL"], key = process.env["DB_SERVICE_KEY"];
  if (!url || !key) throw new Error("DB_SERVICE_KEY is not set");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => {
      const h = new Headers(init?.headers);
      if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
      h.set("apikey", key);
      return fetch(input, { ...init, headers: h });
    } },
  });
}

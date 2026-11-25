import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type Church = { id: string; name: string; city: string | null; country: string | null; default_source_language: string; enabled_languages: string[] };

/** The signed-in user's profile, church and roles. Shared by every workspace page. */
export function useChurchContext() {
  return useQuery({
    queryKey: ["church-context"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const [p, r] = await Promise.all([
        (supabase as any).from("profiles").select("id, display_name, church_id, preferred_language").eq("id", user.id).maybeSingle(),
        supabase.from("user_roles").select("role, church_id").eq("user_id", user.id),
      ]);
      const churchId = p.data?.church_id ?? null;
      const roles = (r.data ?? []).map((x) => x.role as string);
      const church = churchId
        ? ((await (supabase as any).from("churches").select("id, name, city, country, default_source_language, enabled_languages").eq("id", churchId).maybeSingle()).data as Church | null)
        : null;
      const canAdmin = roles.some((x) => x === "church_admin" || x === "platform_admin");
      return { userId: user.id, email: user.email ?? "", profile: p.data, church, roles, canAdmin };
    },
  });
}

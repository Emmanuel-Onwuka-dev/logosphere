CREATE TYPE public.session_status AS ENUM ('draft','live','paused','ended');

CREATE TABLE public.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id uuid NOT NULL REFERENCES public.churches(id) ON DELETE CASCADE,
  title text NOT NULL,
  source_language text NOT NULL DEFAULT 'en',
  target_languages text[] NOT NULL DEFAULT '{}',
  status public.session_status NOT NULL DEFAULT 'draft',
  public_code text NOT NULL UNIQUE DEFAULT lower(substr(replace(gen_random_uuid()::text,'-',''),1,8)),
  started_at timestamptz,
  ended_at timestamptz,
  total_live_seconds integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sessions TO authenticated;
GRANT ALL ON public.sessions TO service_role;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.can_operate_church(_user_id uuid, _church_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_church_role(_user_id,_church_id,'church_admin')
      OR public.has_church_role(_user_id,_church_id,'media_operator')
      OR public.has_role(_user_id,'platform_admin')
$$;
REVOKE EXECUTE ON FUNCTION public.can_operate_church(uuid,uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.can_operate_church(uuid,uuid) TO authenticated;

CREATE POLICY "Members read church sessions" ON public.sessions FOR SELECT TO authenticated
  USING (public.is_church_member(auth.uid(), church_id) OR public.can_operate_church(auth.uid(), church_id));
CREATE POLICY "Operators create sessions" ON public.sessions FOR INSERT TO authenticated
  WITH CHECK (public.can_operate_church(auth.uid(), church_id) AND created_by = auth.uid());
CREATE POLICY "Operators update sessions" ON public.sessions FOR UPDATE TO authenticated
  USING (public.can_operate_church(auth.uid(), church_id)) WITH CHECK (public.can_operate_church(auth.uid(), church_id));
CREATE POLICY "Admins delete sessions" ON public.sessions FOR DELETE TO authenticated
  USING (public.has_church_role(auth.uid(), church_id, 'church_admin') OR public.has_role(auth.uid(),'platform_admin'));

CREATE TRIGGER sessions_updated_at BEFORE UPDATE ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.listener_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  language text NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz
);
CREATE INDEX listener_connections_session_idx ON public.listener_connections(session_id);
GRANT SELECT ON public.listener_connections TO authenticated;
GRANT ALL ON public.listener_connections TO service_role;
ALTER TABLE public.listener_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Operators read listeners" ON public.listener_connections FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.sessions s WHERE s.id = session_id AND public.can_operate_church(auth.uid(), s.church_id)));

ALTER PUBLICATION supabase_realtime ADD TABLE public.sessions, public.listener_connections;
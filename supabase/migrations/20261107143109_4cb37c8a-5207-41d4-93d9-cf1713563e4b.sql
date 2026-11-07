CREATE TABLE public.channel_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  language text NOT NULL,
  engine_id uuid REFERENCES public.ai_engines(id) ON DELETE SET NULL,
  worker_id text,
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','running','error','stopped')),
  last_error text,
  latency_ms integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, language)
);
GRANT SELECT ON public.channel_status TO authenticated;
GRANT ALL ON public.channel_status TO service_role;
ALTER TABLE public.channel_status ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Church members and platform admins read channel status" ON public.channel_status
FOR SELECT TO authenticated USING (
  public.has_role(auth.uid(), 'platform_admin') OR EXISTS (
    SELECT 1 FROM public.sessions s WHERE s.id = session_id AND public.is_church_member(auth.uid(), s.church_id)));
CREATE TRIGGER channel_status_updated_at BEFORE UPDATE ON public.channel_status
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
ALTER PUBLICATION supabase_realtime ADD TABLE public.channel_status;
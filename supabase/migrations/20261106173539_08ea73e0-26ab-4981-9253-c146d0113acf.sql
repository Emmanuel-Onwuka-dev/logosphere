CREATE TABLE public.playground_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL DEFAULT auth.uid(),
  endpoint_id uuid REFERENCES public.inference_endpoints(id) ON DELETE SET NULL,
  engine_id uuid REFERENCES public.ai_engines(id) ON DELETE SET NULL,
  batch_id uuid NOT NULL,
  source_language text NOT NULL,
  target_language text NOT NULL,
  input_name text,
  input_bytes integer,
  ok boolean NOT NULL DEFAULT false,
  status_code integer,
  latency_ms integer,
  output_kind text,
  output_text text,
  error text,
  rating smallint,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.playground_runs TO authenticated;
GRANT ALL ON public.playground_runs TO service_role;
ALTER TABLE public.playground_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Platform admins manage playground runs" ON public.playground_runs FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'platform_admin')) WITH CHECK (public.has_role(auth.uid(), 'platform_admin'));
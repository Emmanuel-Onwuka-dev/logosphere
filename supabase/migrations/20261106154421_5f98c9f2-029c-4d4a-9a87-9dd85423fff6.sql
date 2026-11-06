CREATE TABLE public.ai_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  provider_type text NOT NULL DEFAULT 'hosted_api',
  status text NOT NULL DEFAULT 'testing',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.ai_engines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.ai_providers(id) ON DELETE CASCADE,
  engine_name text NOT NULL,
  model_id text,
  model_version text,
  engine_type text NOT NULL DEFAULT 'speech_to_speech',
  deployment_type text NOT NULL DEFAULT 'hosted_api',
  supported_languages text[] NOT NULL DEFAULT '{}',
  supported_language_pairs text[] NOT NULL DEFAULT '{}',
  input_format text,
  output_format text,
  streaming boolean NOT NULL DEFAULT false,
  max_concurrency integer,
  timeout_ms integer NOT NULL DEFAULT 10000,
  status text NOT NULL DEFAULT 'disabled',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.inference_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engine_id uuid NOT NULL REFERENCES public.ai_engines(id) ON DELETE CASCADE,
  endpoint_name text NOT NULL,
  endpoint_type text NOT NULL DEFAULT 'http',
  endpoint_url text,
  websocket_url text,
  healthcheck_url text,
  auth_method text NOT NULL DEFAULT 'none',
  secret_ref text,
  status text NOT NULL DEFAULT 'unknown',
  last_checked_at timestamptz,
  last_latency_ms integer,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.engine_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engine_id uuid NOT NULL REFERENCES public.ai_engines(id) ON DELETE CASCADE,
  source_language text NOT NULL,
  target_language text NOT NULL,
  processing_mode text NOT NULL DEFAULT 'direct',
  priority integer NOT NULL DEFAULT 1,
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.endpoint_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id uuid NOT NULL REFERENCES public.inference_endpoints(id) ON DELETE CASCADE,
  ok boolean NOT NULL,
  status_code integer,
  latency_ms integer,
  error text,
  checked_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.ai_engines(provider_id);
CREATE INDEX ON public.inference_endpoints(engine_id);
CREATE INDEX ON public.engine_assignments(source_language, target_language);
CREATE INDEX ON public.endpoint_checks(endpoint_id, checked_at DESC);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['ai_providers','ai_engines','inference_endpoints','engine_assignments','endpoint_checks'] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY "Platform admins manage" ON public.%I FOR ALL TO authenticated USING (public.has_role(auth.uid(), ''platform_admin'')) WITH CHECK (public.has_role(auth.uid(), ''platform_admin''))', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['ai_providers','ai_engines','inference_endpoints','engine_assignments'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()', t || '_updated_at', t);
  END LOOP;
END $$;
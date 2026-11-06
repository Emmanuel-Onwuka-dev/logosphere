CREATE OR REPLACE FUNCTION public.get_public_session(_code text)
RETURNS TABLE(title text, church_name text, status public.session_status, source_language text, target_languages text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.title, c.name, s.status, s.source_language, s.target_languages
  FROM public.sessions s JOIN public.churches c ON c.id = s.church_id
  WHERE s.public_code = lower(_code) LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.join_session(_code text, _language text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _sid uuid; _langs text[]; _st public.session_status; _id uuid;
BEGIN
  SELECT id, target_languages, status INTO _sid, _langs, _st FROM public.sessions WHERE public_code = lower(_code);
  IF _sid IS NULL THEN RAISE EXCEPTION 'Session not found'; END IF;
  IF _st = 'ended' THEN RAISE EXCEPTION 'Session has ended'; END IF;
  IF NOT (_language = ANY(_langs)) THEN RAISE EXCEPTION 'Language not offered'; END IF;
  INSERT INTO public.listener_connections(session_id, language) VALUES (_sid, _language) RETURNING id INTO _id;
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.listener_heartbeat(_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.listener_connections SET last_seen_at = now() WHERE id = _id AND left_at IS NULL
$$;

CREATE OR REPLACE FUNCTION public.leave_session(_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.listener_connections SET left_at = now() WHERE id = _id AND left_at IS NULL
$$;

REVOKE EXECUTE ON FUNCTION public.get_public_session(text), public.join_session(text,text), public.listener_heartbeat(uuid), public.leave_session(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_public_session(text), public.join_session(text,text), public.listener_heartbeat(uuid), public.leave_session(uuid) TO anon, authenticated;
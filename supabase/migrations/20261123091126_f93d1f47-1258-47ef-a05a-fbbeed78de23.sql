UPDATE public.ai_providers SET status='paused' WHERE lower(name)='intron';
UPDATE public.ai_engines SET status='paused' WHERE provider_id IN (SELECT id FROM public.ai_providers WHERE lower(name)='intron');
UPDATE public.inference_endpoints SET status='paused' WHERE engine_id IN (SELECT id FROM public.ai_engines WHERE status='paused' AND provider_id IN (SELECT id FROM public.ai_providers WHERE lower(name)='intron'));
UPDATE public.engine_assignments SET enabled=false WHERE target_language IN ('ha','yo','ig');
DO $$
DECLARE p uuid; nova uuid; aura uuid;
BEGIN
SELECT id INTO p FROM public.ai_providers WHERE lower(name)='deepgram' ORDER BY created_at LIMIT 1;
IF p IS NULL THEN INSERT INTO public.ai_providers(name,provider_type,status,notes) VALUES ('Deepgram','hosted_api','testing','https://deepgram.com — server-only speech tests') RETURNING id INTO p; END IF;
SELECT id INTO nova FROM public.ai_engines WHERE provider_id=p AND model_id='nova-3' LIMIT 1;
IF nova IS NULL THEN INSERT INTO public.ai_engines(provider_id,engine_name,model_id,engine_type,deployment_type,supported_languages,streaming,status,input_format,output_format,timeout_ms) VALUES(p,'Deepgram Nova-3','nova-3','asr','hosted_api',ARRAY['en','fr','es','pt'],true,'testing','linear16 16kHz mono','text',150000) RETURNING id INTO nova; END IF;
SELECT id INTO aura FROM public.ai_engines WHERE provider_id=p AND model_id='aura-2' LIMIT 1;
IF aura IS NULL THEN INSERT INTO public.ai_engines(provider_id,engine_name,model_id,engine_type,deployment_type,supported_languages,streaming,status,input_format,output_format,timeout_ms) VALUES(p,'Deepgram Aura-2','aura-2','tts','hosted_api',ARRAY['en','fr','es'],true,'testing','text','wav',60000) RETURNING id INTO aura; END IF;
IF NOT EXISTS(SELECT 1 FROM public.inference_endpoints WHERE engine_id=nova AND endpoint_name='Deepgram Nova-3 transcription') THEN INSERT INTO public.inference_endpoints(engine_id,endpoint_name,endpoint_type,endpoint_url,websocket_url,auth_method,secret_ref,status) VALUES(nova,'Deepgram Nova-3 transcription','websocket','https://api.deepgram.com/v1/listen','wss://api.deepgram.com/v1/listen','api_key','DEEPGRAM_API_KEY','unknown'); END IF;
IF NOT EXISTS(SELECT 1 FROM public.inference_endpoints WHERE engine_id=aura AND endpoint_name='Deepgram Aura-2 speech') THEN INSERT INTO public.inference_endpoints(engine_id,endpoint_name,endpoint_type,endpoint_url,auth_method,secret_ref,status) VALUES(aura,'Deepgram Aura-2 speech','http','https://api.deepgram.com/v1/speak','api_key','DEEPGRAM_API_KEY','unknown'); END IF;
END $$;
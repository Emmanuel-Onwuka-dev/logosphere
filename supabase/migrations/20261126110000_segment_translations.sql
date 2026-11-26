-- Translations produced during transcription (AssemblyAI Speech Understanding), kept per segment.
-- Empty when the sermon was transcribed with Deepgram; translateSegment then uses DeepL.

alter table public.recording_segments
  add column if not exists translations jsonb not null default '{}'::jsonb,
  add column if not exists translation_provider text;

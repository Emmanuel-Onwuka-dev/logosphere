# Deepgram Playground tests

## Scope
English is the preacher source. French, Spanish and Portuguese are active testing targets, not advertised as production-ready. Hausa, Yoruba and Igbo remain in the language catalog as paused. Existing Intron providers, engine and endpoints remain registered and paused; their implementation is retained.

The registered Deepgram Nova-3 engine lists en/fr/es/pt and streaming transcription. Aura-2 lists en/fr/es only. Its test voices are `aura-2-agathe-fr`, `aura-2-celeste-es`, and `aura-2-thalia-en`. Portuguese translation is available for testing, but this test never requests Portuguese Aura-2 speech.

## Server boundary
All provider operations are called through authenticated, platform-admin-only server functions in `src/lib/deepgram.functions.ts`. The actual Deepgram socket and HTTP calls live in `src/lib/deepgram.server.ts`. The server reads `DEEPGRAM_API_KEY` at request time. Registry rows contain only that secret's name. No browser request contacts Deepgram, and no key is returned in results. Built-in translation preserves `openai/gpt-6.1-terra`.

The browser decodes uploads and recordings to mono 16-bit, 16 kHz PCM WAV. Uploaded files must be WAV or MP3, up to 30 MB and three minutes. Short tests require strictly under 120 seconds; microphone recording automatically stops at 119 seconds. The server independently validates PCM audio lengths. Long translated text is split into requests of at most 2,000 characters, with resulting WAV audio joined in order.

## Timing definitions
- **First partial:** milliseconds from opening the server request to the first non-empty, non-final Nova-3 text event. If none is emitted, display a dash, not an invented value.
- **Final text:** time to the last non-empty final text event, including playback-speed audio feeding.
- **Translation complete:** server-measured built-in translation duration.
- **First audio:** server-measured time to PCM bytes, excluding a WAV header alone.
- **Total:** browser elapsed time from starting the clip run through receipt of the last result; includes conversion/upload and server-function round trips. This is not live interpreted-audio playback latency.

The continuous test accepts files up to 21 minutes (matching the audible delay test). It plays the local file at 1×, dispatching one independently authenticated server call per eight-second piece. Each piece opens a new Nova-3 streaming connection and feeds 100 ms PCM frames at real-time speed. At most three pieces are in flight. The displayed English-text delay is measured from the first spoken sample of the piece through receipt of its final transcript in the page; it includes queueing and network time. Partial timing is reported after that piece finalises, not streamed separately to the page. A silent piece completes without inventing text or timings.

The delay-growth verdict requires a completed roughly three-minute file and no failed or pending pieces, with at least three spoken pieces. It fits a linear trend to measured display delays; estimated growth greater than one second across the recording is labelled growing. Short, stopped or failed tests are inconclusive. This is a bounded chunk transcription trial, not a persistent stream or a continuous translated-speech benchmark. Stop halts playback and future submissions; already submitted bounded pieces may finish on the server.

## Verification on 2026-11-23
No user audio was supplied; the user said they will upload it later. No timing result or three-minute delay verdict is claimed for the user's clip.

Separate synthetic service-check phrase: “Good morning, brothers and sisters. Let us pray together.”
- Length: 3.4 seconds.
- Nova-3 first partial: 1,568 ms; final text: 4,060 ms; stream complete: 4,070 ms.
- Translation to French with `openai/gpt-6.1-terra`: 1,647 ms; “Bonjour, frères et sœurs. Prions ensemble.”
- Separate voice checks: English first audio 322 ms, French 178 ms, Spanish 163 ms; all returned WAV audio. These were separate calls, not a single-run total.
- A standalone workerd compatibility check also passed: recognised the same English transcript and generated French speech. It is not a signed-in Playground test.

Tests cover language scope, PCM limits, voice coverage, timing events, silence-safe trend analysis, and mocked client orchestration and admin rejection. The externally managed Supabase account prevents an authenticated real-user browser check here; that remains unverified.
All 40 tests passed. Browser module inspection confirmed the Deepgram key was absent, no Deepgram requests were issued, and no server implementation module was downloaded. A separate layout-only browser harness displayed the test form and decoded a synthetic WAV on 390×844 and 1280×1800 screens, with no horizontal page overflow. This does not replace a real signed-in test.

Worker API, listener page and public-route source files are unchanged. Shared catalog status labels reflect the requested pause. Existing session records are retained; new session defaults use only active targets. Pre-existing security warnings (function execution grants and disabled leaked-password protection) were not introduced or changed by this registration migration.
## Audible delay (2026-11-23, user's 3-minute sermon, offline run of the Playground rules)
- French: average 31.3 s, min 15.3 s, max 42.7 s, change start→end +23.6 s (grows: French audio ran ~197 s for 180 s of English).
- Spanish: average 18.6 s, min 14.5 s, max 22.8 s, change +4.1 s.
- 23 pieces; 18 cut at pauses, 5 at the 8 s fallback; one real word split ("gold", 126.17 s, fallback cut).

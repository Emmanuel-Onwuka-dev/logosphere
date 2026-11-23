# Language scope and Deepgram tests
- [x] Set English source; French, Spanish, Portuguese active targets; retain paused Nigerian languages and Intron records.
- [x] Register Deepgram Nova-3 and Aura-2 with accurate language coverage and server-only credentials.
- [x] Add timed short-clip transcription, translation and French/Spanish speech tests.
- [x] Add real-time 8-second continuous-file transcription test with measured delay trend.
- [x] Verify rules, provider samples, server boundary and phone/desktop layout; report timings only from real supplied audio.
- [ ] Verify a real signed-in Playground run — external unmanaged Supabase session is unavailable here.
- [x] Measure the user's short and three-minute recordings (2026-11-23: delay steady at 3–13 s, no growth)
# Audible delay (French, then Spanish)
- [x] Ordered playback of numbered translated pieces; wait for late pieces, no overlap
- [x] Failed piece → silence of the piece length, logged, "piece X failed" note, no retry
- [x] Cut at ≥300 ms pauses within ±2 s of 8 s, else 8 s; cut points shown
- [x] Audible delay test mode with per-piece table, stats and downloadable translated audio
- [x] Run French and Spanish on the user's three-minute clip (offline run of the same rules)
- [ ] Verify the test inside the signed-in Playground — sign-in unavailable here
# French speed-up and 20-minute test
- [x] Pitch-preserving speed (French 1.10×, Spanish 1.00×, 1.00–1.20×), new cut rules, one retry, review CSV
- [ ] Run French then Spanish on the user's 20-minute file (clip-2.mp3)

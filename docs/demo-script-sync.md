Written for: the video team and anyone reproducing the demo on the live site.

# Demo script sync: where each claim is shown in the product

The video's second half shows three capabilities. Each one can be reproduced on `https://app.logosphere.workers.dev` (or locally with `bun run dev`).

## Before you start

- Migrations applied in the Supabase SQL editor, in order:
  1. `supabase/migrations/20261125120000_demo_usage.sql` (public demo allowance)
  2. `supabase/migrations/20261125130000_recordings_and_replies.sql` (recordings, listener replies, `sermon-audio` storage bucket)
- Deployed with `bun run deploy` after the migrations are applied.
- A signed-in church account with the role `church_admin` or `media_operator` on a church. The dashboard shows "Recorded sermons" only when the account belongs to a church.
- A WAV or MP3 test recording, for example a 60-second clip of English speech with a few pauses.

## 1. Live sermon interpretation (already working)

| Narration point | Where it is shown | Steps to reproduce |
|---|---|---|
| The preacher speaks English into a microphone and it is interpreted live | Landing page, "Try it with your own voice" (`src/components/landing/TryLive.tsx`) | Open the home page, choose French or Spanish, press "Start listening", speak English. English and translation lines appear, and the translated voice plays. |
| Congregants scan a QR code and pick a language | Session page (`src/routes/_authenticated/sessions.$id.tsx`) shows the QR code; listener page `src/routes/s.$code.tsx` | Sign in, open a live session, show the QR code. Scan it or open the link, pick a language, and listen. |

The live microphone demo and the listener page are unchanged in this work.

## 2. Recorded sermon translation (new)

| Narration point | Where it is shown | Steps to reproduce |
|---|---|---|
| A church uploads a recorded sermon | `/recordings` (`src/routes/_authenticated/recordings.tsx`), reached from the dashboard's "Recorded sermons" button | Enter a title, choose French and/or Spanish, choose the WAV or MP3 file, press "Translate recording". |
| The system translates it piece by piece | Same page: progress line such as "French: 12 of 143 pieces" | Keep the page open until "Recording translated" appears. The browser sends one piece at a time, three in parallel. |
| Listeners hear the translated sermon | Public page `/r/<code>` (`src/routes/r.$code.tsx`), linked from the QR code and the "Listener link" in "Your recordings" | Open the link, choose a language, press "Play". Text for each piece appears as it plays. |

Notes for the video team:
- The browser must stay open while a recording is translated. A 20-minute sermon takes several minutes per language.
- Recordings up to 21 minutes are accepted (`LONG_TEST_LIMIT_SECONDS`).
- Pieces that fail twice are kept silent, and the page reports how many.

## 3. Outreach with replies (new, minimal version)

| Narration point | Where it is shown | Steps to reproduce |
|---|---|---|
| A listener answers in their own language on their phone | Listener page `/s/<code>` after choosing French or Spanish, under the player: "Answer the preacher" (`src/components/listener/ListenerReply.tsx`) | Start a live session, open the listener link, choose a language, press "Reply", speak for a few seconds, then "Send reply". |
| The answer is transcribed and translated to English | Same panel: "You said" and "In English" | Shown to the listener immediately. |
| The preacher sees the English reply | Session page, "Listener replies" panel (`src/components/live/SessionReplies.tsx`), refreshed every 4 seconds | Keep the session page open while the listener replies. |

Limits:
- A listener may send 60 seconds of reply speech per visitor per day (`REPLY_LIMIT_SECONDS` in `src/lib/replies.functions.ts`). This is a new limit, separate from the 3-minute public demo.
- Replies are accepted only while the session is live. Each reply is up to 10 seconds, and one reply is sent at a time.
- The preacher sees text only. No audio goes back to the preacher in this version.

## Not changed

- The Portuguese and Nigerian language entries stay "Coming soon".
- The landing page's "Coming soon" note about two-way listening stays until the reply feature has been checked on the live site. Remove it only after that check.
- The public demo limit (3 minutes per visitor per day) is unchanged.

## Automated checks

- `bun run build` and `bun run test` (the repo's Vitest suite, 67 tests) pass.
- No end-to-end Playwright run has been done yet. It needs the migrations applied and a signed-in test account; it is the next step before the video is recorded.

## Narration check (Scenes 2–3 of the 5-minute script)

Scene 1 (the story) makes no product claims, so it is not mapped.

| Narration line | Shown on | Status |
|---|---|---|
| "Introducing LOGOSPHERE" | Home page hero | OK |
| "First: Live Sermon Interpretation." | Home page "Try it with your own voice"; session page | OK |
| "A preacher speaks naturally into a microphone." | Session page, Broadcaster (`sessions.$id`) | OK |
| "Logosphere interprets the sermon in real time" | Live channels for French and Spanish | **Check the word "real time".** The last measured audible delay was about 19 s (Spanish) and 25 s (French) on a 20-minute clip, before adaptive playback. Measure again on the live site before using "real time", or say "live". |
| "into different languages" | Languages: French and Spanish only. Portuguese and Nigerian languages show "Coming soon" | **Name the two languages** in the voice-over. |
| "Congregants simply scan a QR code, select their preferred language and listen on their phones." | QR code on the session page, then `/s/<code>`, language picker, player | OK. Audio needs an active interpreter for the chosen language. |
| "Second: Recorded Sermon Translation." | `/recordings` (operator) and `/r/<code>` (listener) | OK |
| "Upload a recorded sermon, select your preferred language" | Recordings form: WAV or MP3, French or Spanish, up to 21 minutes | OK. Keep the browser open while it translates. |
| "Third: Evangelism and Outreach." | Home page "Beyond the sermon" section | OK |
| "You speak in your language, and they hear the message in theirs." | Live channels, same as the first capability | OK |
| "When they respond or ask questions, Logosphere translates their words back to you." | Listener "Answer the preacher" panel, then "Listener replies" on the session page | **Text only, not spoken.** Each reply is up to 10 seconds, one at a time, and limited to 60 seconds per visitor per day. Say "shows" rather than "speaks", or add an audio output. |
| "Now, a conversation can happen without needing an interpreter physically present." | As above | **Overstated.** Replies are single short turns, not a conversation. Suggest "answers can be understood without an interpreter". |

Open items for the team, not changed in the product yet:
1. **"Real time"**: re-measure the audible delay on the live site, or change the word.
2. **Listener page copy**: done. The line now reads "Keep this page open while the service is running." The status line above it still reports whether interpreted audio is waiting or playing.
3. **Landing page "Coming soon"** for two-way listening stays until replies are checked on the live site.

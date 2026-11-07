import { useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track, createLocalAudioTrack, type LocalAudioTrack } from "livekit-client";
import { useServerFn } from "@tanstack/react-start";
import { Mic, MicOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getBroadcastToken } from "@/lib/livekit.functions";

/** Publishes the preacher's microphone to the session's live audio room. */
export function Broadcaster({ sessionId, live }: { sessionId: string; live: boolean }) {
  const getToken = useServerFn(getBroadcastToken);
  const [state, setState] = useState<"off" | "connecting" | "on">("off");
  const [level, setLevel] = useState(0);
  const roomRef = useRef<Room | null>(null);
  const trackRef = useRef<LocalAudioTrack | null>(null);

  async function start() {
    setState("connecting");
    try {
      const { url, token } = await getToken({ data: { sessionId } });
      const room = new Room();
      room.on(RoomEvent.Disconnected, () => setState("off"));
      await room.connect(url, token);
      const track = await createLocalAudioTrack({ echoCancellation: true, noiseSuppression: true, autoGainControl: true });
      await room.localParticipant.publishTrack(track as any, { name: "source", source: Track.Source.Microphone });
      roomRef.current = room; trackRef.current = track; setState("on");
    } catch (e: any) {
      toast.error(e?.name === "NotAllowedError" ? "Microphone permission was denied" : e?.message ?? "Couldn't start live audio");
      stop();
    }
  }
  function stop() {
    trackRef.current?.stop(); trackRef.current = null;
    roomRef.current?.disconnect(); roomRef.current = null;
    setState("off"); setLevel(0);
  }

  useEffect(() => {
    if (state !== "on" || !trackRef.current) return;
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(new MediaStream([trackRef.current.mediaStreamTrack]));
    const an = ctx.createAnalyser(); an.fftSize = 512; src.connect(an);
    const buf = new Uint8Array(an.fftSize); let raf = 0;
    const loop = () => { an.getByteTimeDomainData(buf); let m = 0; for (const v of buf) m = Math.max(m, Math.abs(v - 128)); setLevel(m / 128); raf = requestAnimationFrame(loop); };
    loop();
    return () => { cancelAnimationFrame(raf); ctx.close(); };
  }, [state]);

  useEffect(() => { trackRef.current && (live ? trackRef.current.unmute() : trackRef.current.mute()); }, [live, state]);
  useEffect(() => () => stop(), []);

  return (
    <section className="mt-6 rounded-3xl border bg-card p-6 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl">Preacher microphone</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {state === "on" ? (live ? "Sending live audio to listeners." : "Connected — muted until the session is live.") : "Use this device's microphone or a connected mixer input."}
          </p>
        </div>
        {state === "on"
          ? <button onClick={stop} className="inline-flex items-center gap-2 rounded-full border px-5 py-2.5 text-sm font-medium"><MicOff className="size-4" /> Stop microphone</button>
          : <button onClick={start} disabled={state === "connecting"} className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-60">
              {state === "connecting" ? <Loader2 className="size-4 animate-spin" /> : <Mic className="size-4" />} Connect microphone
            </button>}
      </div>
      <div className="mt-5 h-2 overflow-hidden rounded-full bg-secondary"><div className="h-full bg-live transition-[width] duration-75" style={{ width: `${Math.min(100, level * 140)}%` }} /></div>
    </section>
  );
}

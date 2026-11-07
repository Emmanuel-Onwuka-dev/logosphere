import { useEffect, useRef, useState } from "react";
import { Room, RoomEvent, type RemoteTrack } from "livekit-client";
import { getListenToken } from "@/lib/livekit.functions";

/** Joins the session's audio room and plays the track with the given name (e.g. "source" or "interp-fr"). */
export function useListen(code: string, trackName: string, enabled: boolean) {
  const [state, setState] = useState<"idle" | "connecting" | "waiting" | "playing" | "blocked" | "error">("idle");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const roomRef = useRef<Room | null>(null);

  useEffect(() => {
    if (!enabled) { setState("idle"); return; }
    let cancelled = false;
    const room = new Room({ adaptiveStream: false });
    roomRef.current = room;
    const attach = (t: RemoteTrack, name: string) => {
      if (name !== trackName || t.kind !== "audio") return;
      const el = t.attach() as HTMLAudioElement; audioRef.current = el; document.body.appendChild(el);
      el.play().then(() => setState("playing")).catch(() => setState("blocked"));
    };
    room.on(RoomEvent.TrackSubscribed, (t, pub) => attach(t, pub.trackName));
    room.on(RoomEvent.TrackUnsubscribed, (t, pub) => { if (pub.trackName === trackName) { t.detach().forEach((e) => e.remove()); setState("waiting"); } });
    room.on(RoomEvent.TrackMuted, (pub) => { if (pub.trackName === trackName) setState("waiting"); });
    room.on(RoomEvent.TrackUnmuted, (pub) => { if (pub.trackName === trackName) setState("playing"); });
    room.on(RoomEvent.Disconnected, () => { if (!cancelled) setState("error"); });
    setState("connecting");
    getListenToken({ data: { code } })
      .then(({ url, token }) => cancelled ? null : room.connect(url, token))
      .then(() => { if (!cancelled) setState((s) => (s === "connecting" ? "waiting" : s)); })
      .catch(() => { if (!cancelled) setState("error"); });
    return () => { cancelled = true; room.disconnect(); document.querySelectorAll("audio[data-lk]").forEach((e) => e.remove()); audioRef.current?.remove(); };
  }, [code, trackName, enabled]);

  const resume = () => { roomRef.current?.startAudio(); audioRef.current?.play().then(() => setState("playing")).catch(() => {}); };
  return { state, resume };
}

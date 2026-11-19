"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { VoiceEvent } from "@/lib/voice/types";

// ---------- Minimal Web Speech API typings (not in lib.dom) ----------
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// ---------- Helpers ----------
type LogEntry = { id: number; who: "you" | "claude" | "tool" | "system"; text: string };
type Phase = "idle" | "listening" | "working" | "speaking" | "confirming";

const LS = { pass: "voice.passcode", session: "voice.sessionId", rate: "voice.rate", voice: "voice.voiceName", handsFree: "voice.handsFree", narrate: "voice.narrate" };

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — settings just won't persist */
  }
}

/** Turn agent markdown into something pleasant to hear. */
function toSpeech(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " (code shown on screen) ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "a link")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\|.*\|\s*$/gm, "")
    .replace(/[*_~>#|]/g, "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Chrome cuts off long utterances, so speak sentence-sized chunks. */
function chunk(text: string, max = 220): string[] {
  const sentences = text.match(/[^.!?]+[.!?]*\s*/g) ?? [text];
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if ((cur + s).length > max && cur) {
      out.push(cur.trim());
      cur = "";
    }
    cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const YES = /\b(yes|yeah|yep|sure|ok|okay|allow|approve|go ahead|do it|confirm)\b/i;
const STOP = /^(stop|cancel|never ?mind|abort|halt)\b/i;
const REPEAT = /^(repeat|say (that|it) again|what did you say)\b/i;
const NEW_SESSION = /^(new session|start over|fresh session)\b/i;

/** 1s of silent audio, looped, so the headphone play/pause button reaches this page (Media Session API). */
function makeSilentWavUrl(): string {
  const rate = 8000;
  const samples = rate;
  const buf = new ArrayBuffer(44 + samples * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + samples * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, samples * 2, true);
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}

export default function VoicePage() {
  const [passcode, setPasscode] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [interim, setInterim] = useState("");
  const [log, setLog] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState({ stt: true, tts: true });
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceName, setVoiceName] = useState("");
  const [rate, setRate] = useState(1.05);
  const [handsFree, setHandsFree] = useState(false);
  const [narrate, setNarrate] = useState(false);
  const [headphoneButton, setHeadphoneButton] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<{ toolUseId: string; summary: string } | null>(null);

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const logId = useRef(0);
  const lastSpoken = useRef("");
  const busyRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Refs mirror state so async callbacks always see current values.
  const stateRef = useRef({ passcode, sessionId, handsFree, narrate, voiceName, rate, pendingConfirm, phase });
  stateRef.current = { passcode, sessionId, handsFree, narrate, voiceName, rate, pendingConfirm, phase };

  const addLog = useCallback((who: LogEntry["who"], text: string) => {
    setLog((l) => [...l.slice(-199), { id: ++logId.current, who, text }]);
  }, []);

  // ---------- Load settings ----------
  useEffect(() => {
    setPasscode(lsGet(LS.pass) ?? "");
    setSessionId(lsGet(LS.session));
    const r = Number(lsGet(LS.rate));
    if (r) setRate(r);
    setVoiceName(lsGet(LS.voice) ?? "");
    setHandsFree(lsGet(LS.handsFree) === "1");
    setNarrate(lsGet(LS.narrate) === "1");
    setSupported({ stt: !!getRecognitionCtor(), tts: typeof window !== "undefined" && "speechSynthesis" in window });
    if ("speechSynthesis" in window) {
      const load = () => setVoices(window.speechSynthesis.getVoices());
      load();
      window.speechSynthesis.onvoiceschanged = load;
    }
  }, []);

  // ---------- Text to speech ----------
  const speak = useCallback((text: string): Promise<void> => {
    const spoken = toSpeech(text);
    if (!spoken || !("speechSynthesis" in window)) return Promise.resolve();
    lastSpoken.current = spoken;
    const { voiceName: vn, rate: rt } = stateRef.current;
    const voice = window.speechSynthesis.getVoices().find((v) => v.name === vn);
    const parts = chunk(spoken);
    setPhase((p) => (p === "confirming" ? p : "speaking"));
    return new Promise((resolve) => {
      parts.forEach((part, i) => {
        const u = new SpeechSynthesisUtterance(part);
        if (voice) u.voice = voice;
        u.rate = rt;
        if (i === parts.length - 1) {
          u.onend = () => resolve();
          u.onerror = () => resolve();
        }
        window.speechSynthesis.speak(u);
      });
    });
  }, []);

  const stopSpeaking = useCallback(() => {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);

  // ---------- API ----------
  const api = useCallback(async (path: string, body: unknown) => {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-voice-passcode": stateRef.current.passcode },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || `Request failed (${res.status})`);
    }
    return res;
  }, []);

  const newSession = useCallback(async (): Promise<string> => {
    addLog("system", "Starting a new remote session…");
    const res = await api("/api/voice/session", {});
    const { sessionId: id, repo } = await res.json();
    setSessionId(id);
    lsSet(LS.session, id);
    addLog("system", `Session ready${repo ? ` with ${repo} mounted` : ""}.`);
    return id;
  }, [addLog, api]);

  // ---------- Listening ----------
  // `onFinal` receives the final transcript; declared via ref to break the circular dependency with runCommand.
  const onFinalRef = useRef<(text: string) => void>(() => {});

  const listen = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setError("Speech recognition isn't supported in this browser. Use Chrome, Edge or Safari — or type below.");
      return;
    }
    stopSpeaking();
    recRef.current?.abort();
    const rec = new Ctor();
    rec.lang = navigator.language || "en-US";
    rec.continuous = false;
    rec.interimResults = true;
    let finalText = "";
    rec.onresult = (e) => {
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interimText += r[0].transcript;
      }
      setInterim(finalText + interimText);
    };
    rec.onerror = (e) => {
      if (e.error !== "no-speech" && e.error !== "aborted") setError(`Microphone error: ${e.error}`);
    };
    rec.onend = () => {
      recRef.current = null;
      setInterim("");
      const text = finalText.trim();
      if (text) onFinalRef.current(text);
      else setPhase((p) => (p === "listening" ? "idle" : p));
    };
    recRef.current = rec;
    setError(null);
    setPhase((p) => (p === "confirming" ? p : "listening"));
    rec.start();
  }, [stopSpeaking]);

  const stopListening = useCallback(() => recRef.current?.stop(), []);

  // ---------- Running a command ----------
  const afterTurn = useCallback(() => {
    busyRef.current = false;
    setPhase("idle");
    if (stateRef.current.handsFree) setTimeout(() => listen(), 300);
  }, [listen]);

  const askConfirm = useCallback(
    async (toolUseId: string, summary: string) => {
      setPendingConfirm({ toolUseId, summary });
      setPhase("confirming");
      addLog("system", `Approval needed: Claude wants to ${summary}`);
      await speak(`Claude wants to ${summary}. Say yes to allow, or no to deny.`);
      listen();
    },
    [addLog, listen, speak],
  );

  const runCommand = useCallback(
    async (text: string | null) => {
      busyRef.current = true;
      setPhase("working");
      let speechChain: Promise<void> = Promise.resolve();
      const say = (t: string) => (speechChain = speechChain.then(() => speak(t)));
      const handled = new Set<string>(); // a resume replays the turn; never speak or ask twice
      try {
        const sid = stateRef.current.sessionId ?? (await newSession());
        let attempts = 0;
        let payload: { sessionId: string; text?: string } = text ? { sessionId: sid, text } : { sessionId: sid };
        // Loop so a cut connection re-attaches to the same session (resume) instead of losing the reply.
        for (;;) {
          const res = await api("/api/voice/command", payload);
          const reader = res.body!.getReader();
          const decoder = new TextDecoder();
          let buf = "";
          let finished = false;
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            let nl: number;
            while ((nl = buf.indexOf("\n")) >= 0) {
              const line = buf.slice(0, nl).trim();
              buf = buf.slice(nl + 1);
              if (!line) continue;
              const ev = JSON.parse(line) as VoiceEvent;
              switch (ev.type) {
                case "message":
                  if (ev.id && handled.has(ev.id)) break;
                  handled.add(ev.id);
                  addLog("claude", ev.text);
                  say(ev.text);
                  break;
                case "tool":
                  addLog("tool", ev.summary);
                  if (stateRef.current.narrate) say(`Working: ${ev.summary}`);
                  break;
                case "confirm":
                  if (handled.has(ev.toolUseId)) break;
                  handled.add(ev.toolUseId);
                  await speechChain;
                  await askConfirm(ev.toolUseId, ev.summary);
                  break;
                case "error":
                  addLog("system", `Error: ${ev.message}`);
                  say(`There was an error. ${ev.message}`);
                  break;
                case "done":
                  finished = true;
                  if (ev.reason === "refusal") say("Claude declined that request.");
                  if (ev.reason === "budget_reached") say("The session reached its budget.");
                  break;
                case "status":
                  if (ev.status === "running" && stateRef.current.phase !== "confirming") setPhase("working");
                  break;
              }
            }
          }
          if (finished) break;
          if (++attempts > 5) throw new Error("Lost connection to the session.");
          payload = { sessionId: sid }; // resume without re-sending the command
        }
        await speechChain;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        addLog("system", `Error: ${msg}`);
        await speak(`Sorry, ${msg}`);
      } finally {
        afterTurn();
      }
    },
    [addLog, afterTurn, api, askConfirm, newSession, speak],
  );

  const answerConfirm = useCallback(
    async (allow: boolean) => {
      const pc = stateRef.current.pendingConfirm;
      const sid = stateRef.current.sessionId;
      if (!pc || !sid) return;
      setPendingConfirm(null);
      setPhase("working");
      addLog("you", allow ? "Allowed." : "Denied.");
      try {
        await api("/api/voice/confirm", { sessionId: sid, toolUseId: pc.toolUseId, allow });
        speak(allow ? "Allowed." : "Denied.");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [addLog, api, speak],
  );

  const interrupt = useCallback(async () => {
    stopSpeaking();
    const sid = stateRef.current.sessionId;
    if (!sid) return;
    addLog("system", "Stopping Claude…");
    try {
      await api("/api/voice/interrupt", { sessionId: sid });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [addLog, api, stopSpeaking]);

  // What happens with a finished utterance.
  onFinalRef.current = (text: string) => {
    if (stateRef.current.pendingConfirm) {
      addLog("you", text);
      void answerConfirm(YES.test(text));
      return;
    }
    if (STOP.test(text)) {
      addLog("you", text);
      void interrupt();
      if (!busyRef.current) setPhase("idle");
      return;
    }
    if (REPEAT.test(text)) {
      void speak(lastSpoken.current || "Nothing to repeat yet.").then(() => setPhase("idle"));
      return;
    }
    if (NEW_SESSION.test(text)) {
      addLog("you", text);
      void newSession()
        .then(() => speak("New session ready."))
        .catch((e) => setError(String(e)))
        .finally(() => setPhase("idle"));
      return;
    }
    if (busyRef.current) {
      addLog("you", `${text} (ignored: Claude is still working)`);
      void speak("Claude is still working. Say stop to cancel, or wait for the reply.");
      return;
    }
    addLog("you", text);
    void runCommand(text);
  };

  // ---------- Push-to-talk keyboard shortcut (Space) ----------
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.code !== "Space" || e.repeat || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      e.preventDefault();
      if (recRef.current) stopListening();
      else listen();
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [listen, stopListening]);

  // ---------- Headphone play/pause button → talk ----------
  useEffect(() => {
    if (!headphoneButton || !("mediaSession" in navigator)) return;
    const audio = audioRef.current;
    if (audio && !audio.src) audio.src = makeSilentWavUrl();
    audio?.play().catch(() => setError("Tap the page once so the headphone button can be enabled."));
    const toggle = () => {
      audio?.play().catch(() => {});
      if (recRef.current) stopListening();
      else if (stateRef.current.phase === "speaking") stopSpeaking();
      else listen();
    };
    navigator.mediaSession.metadata = new MediaMetadata({ title: "Voice Claude", artist: "Press to talk" });
    navigator.mediaSession.setActionHandler("play", toggle);
    navigator.mediaSession.setActionHandler("pause", toggle);
    return () => {
      navigator.mediaSession.setActionHandler("play", null);
      navigator.mediaSession.setActionHandler("pause", null);
      audio?.pause();
    };
  }, [headphoneButton, listen, stopListening, stopSpeaking]);

  // ---------- UI ----------
  const [typed, setTyped] = useState("");
  const logEnd = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    logEnd.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [log]);

  const phaseLabel: Record<Phase, string> = {
    idle: "Tap the mic (or press Space) and speak",
    listening: "Listening…",
    working: "Claude is working in the remote session…",
    speaking: "Speaking…",
    confirming: "Say “yes” or “no”",
  };
  const micColor =
    phase === "listening" || phase === "confirming"
      ? "bg-red-500 animate-pulse"
      : phase === "working"
        ? "bg-amber-500"
        : phase === "speaking"
          ? "bg-emerald-500"
          : "bg-indigo-600 hover:bg-indigo-500";

  return (
    <main className="min-h-screen w-full bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <audio ref={audioRef} loop preload="none" />
      <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-6">
        <header className="flex items-center justify-between gap-2">
          <h1 className="text-2xl font-bold">Voice Claude</h1>
          <span className="truncate text-xs text-zinc-500" title={sessionId ?? ""}>
            {sessionId ? `Session ${sessionId.slice(-8)}` : "No session yet"}
          </span>
        </header>

        {!passcode && (
          <p className="rounded-md bg-amber-100 p-3 text-sm text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
            Enter the passcode set in <code>VOICE_APP_PASSCODE</code> to start.
          </p>
        )}
        {(!supported.stt || !supported.tts) && (
          <p className="rounded-md bg-amber-100 p-3 text-sm text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
            {!supported.stt && "This browser can't do speech recognition (try Chrome, Edge or Safari) — you can still type. "}
            {!supported.tts && "This browser can't speak replies."}
          </p>
        )}

        <section className="flex flex-col items-center gap-3 py-4">
          <button
            type="button"
            aria-label={phase === "listening" ? "Stop listening" : "Start talking"}
            disabled={!passcode}
            onClick={() => (recRef.current ? stopListening() : listen())}
            className={`flex h-32 w-32 items-center justify-center rounded-full text-white shadow-lg transition disabled:opacity-40 ${micColor}`}
          >
            <svg viewBox="0 0 24 24" className="h-14 w-14" fill="currentColor" aria-hidden>
              <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z" />
            </svg>
          </button>
          <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">{phaseLabel[phase]}</p>
          {interim && <p className="text-center text-lg italic">“{interim}”</p>}

          {pendingConfirm && (
            <div className="flex gap-2">
              <button className="rounded-md bg-emerald-600 px-4 py-2 text-white" onClick={() => answerConfirm(true)}>
                Allow
              </button>
              <button className="rounded-md bg-zinc-600 px-4 py-2 text-white" onClick={() => answerConfirm(false)}>
                Deny
              </button>
            </div>
          )}

          <div className="flex flex-wrap justify-center gap-2 text-sm">
            <button className="rounded-md border border-zinc-300 px-3 py-1 dark:border-zinc-700" onClick={interrupt} disabled={!sessionId}>
              Stop Claude
            </button>
            <button className="rounded-md border border-zinc-300 px-3 py-1 dark:border-zinc-700" onClick={stopSpeaking}>
              Mute reply
            </button>
            <button className="rounded-md border border-zinc-300 px-3 py-1 dark:border-zinc-700" onClick={() => speak(lastSpoken.current || "Nothing yet.")}>
              Repeat
            </button>
            <button
              className="rounded-md border border-zinc-300 px-3 py-1 dark:border-zinc-700"
              disabled={!passcode || phase === "working"}
              onClick={() => newSession().catch((e) => setError(String(e)))}
            >
              New session
            </button>
          </div>
        </section>

        {error && <p className="rounded-md bg-red-100 p-3 text-sm text-red-800 dark:bg-red-900/40 dark:text-red-200">{error}</p>}

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (typed.trim()) onFinalRef.current(typed.trim());
            setTyped("");
          }}
        >
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="…or type a command"
            className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button className="rounded-md bg-indigo-600 px-4 py-2 text-white disabled:opacity-40" disabled={!passcode}>
            Send
          </button>
        </form>

        <section className="max-h-[45vh] min-h-32 overflow-y-auto rounded-md border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
          {log.length === 0 && <p className="text-zinc-500">Conversation appears here. Try: “Create a Python script that prints the first 20 primes and run it.”</p>}
          {log.map((e) => (
            <div key={e.id} className="mb-2 whitespace-pre-wrap break-words">
              <span
                className={`mr-2 font-semibold ${
                  e.who === "you" ? "text-indigo-600" : e.who === "claude" ? "text-emerald-600" : e.who === "tool" ? "text-amber-600" : "text-zinc-500"
                }`}
              >
                {e.who === "you" ? "You" : e.who === "claude" ? "Claude" : e.who === "tool" ? "⚙" : "•"}
              </span>
              {e.text}
            </div>
          ))}
          <div ref={logEnd} />
        </section>

        <details className="rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800">
          <summary className="cursor-pointer font-semibold">Settings</summary>
          <div className="mt-3 flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              Passcode
              <input
                type="password"
                value={passcode}
                onChange={(e) => {
                  setPasscode(e.target.value);
                  lsSet(LS.pass, e.target.value);
                }}
                className="rounded-md border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>
            <label className="flex flex-col gap-1">
              Voice
              <select
                value={voiceName}
                onChange={(e) => {
                  setVoiceName(e.target.value);
                  lsSet(LS.voice, e.target.value);
                }}
                className="rounded-md border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
              >
                <option value="">System default</option>
                {voices.map((v) => (
                  <option key={v.name} value={v.name}>
                    {v.name} ({v.lang})
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              Speaking speed: {rate.toFixed(2)}×
              <input
                type="range"
                min={0.7}
                max={1.6}
                step={0.05}
                value={rate}
                onChange={(e) => {
                  setRate(Number(e.target.value));
                  lsSet(LS.rate, e.target.value);
                }}
              />
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={handsFree}
                onChange={(e) => {
                  setHandsFree(e.target.checked);
                  lsSet(LS.handsFree, e.target.checked ? "1" : "0");
                }}
              />
              Hands-free: start listening again after each reply
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={narrate}
                onChange={(e) => {
                  setNarrate(e.target.checked);
                  lsSet(LS.narrate, e.target.checked ? "1" : "0");
                }}
              />
              Narrate each step (commands, file edits) while Claude works
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={headphoneButton} onChange={(e) => setHeadphoneButton(e.target.checked)} />
              Headphone play/pause button = talk (best effort; keep this tab open)
            </label>
            <p className="text-xs text-zinc-500">
              Voice shortcuts: “stop” interrupts Claude · “repeat” replays the last reply · “new session” starts a fresh remote container.
            </p>
          </div>
        </details>
      </div>
    </main>
  );
}

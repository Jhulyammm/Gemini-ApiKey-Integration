"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  IconArrowLeft,
  IconBookmark,
  IconBookmarkPlus,
  IconCameraRotate,
  IconMicrophone,
  IconMicrophoneOff,
  IconPlayerPlayFilled,
  IconPlayerStopFilled,
  IconRefresh,
  IconSettings,
  IconSparkles,
  IconTrash,
} from "@tabler/icons-react";
import {
  AudioCapture,
  AudioPlayer,
  captureFrameJpegBase64,
  int16ToBase64,
} from "@/lib/audio";
import { LiveSession, fetchEphemeralToken } from "@/lib/gemini-live";
import { ASSISTANT } from "@/lib/modes";
import { SensLogo } from "@/components/SensLogo";
import type { FunctionCall } from "@google/genai";

type Status =
  | "idle"
  | "requesting-permissions"
  | "ready"
  | "connecting"
  | "live"
  | "reconnecting"
  | "ended"
  | "error";

interface Memory {
  id: string;
  label: string;
  description: string;
  imageBase64: string;
  mimeType: string;
  timestamp: number;
}

// Failsafe — if the server doesn't send a goAway by this point we force a
// preemptive reconnect ourselves, just shy of the API's 120s hard limit.
const SESSION_FAILSAFE_SEC = 115;
const FRAME_INTERVAL_MS = 1000;
const MEMORIES_KEY = "accesslens:memories"; // keep key for back-compat with existing memories
const MAX_MEMORIES = 20;

// Rotating hints shown when there's no active conversation. Cue the user that
// this is a voice-driven app — they don't need to tap anything to talk.
const VOICE_HINTS = [
  "“describe lo que veo”",
  "“lee este menú”",
  "“traduce este letrero”",
  "“qué significa esto”",
  "“guarda esto en memorias”",
  "“dónde queda la farmacia”",
];

function formatTime(s: number) {
  const m = Math.floor(s / 60).toString().padStart(2, "0");
  const sec = (s % 60).toString().padStart(2, "0");
  return `${m}:${sec}`;
}

export default function LivePage() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [userCaption, setUserCaption] = useState("");
  const [aiCaption, setAiCaption] = useState("");
  const [audioLevel, setAudioLevel] = useState(0);
  const [muted, setMuted] = useState(false);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [memoriesOpen, setMemoriesOpen] = useState(false);
  const [memorySaving, setMemorySaving] = useState<{ label: string } | null>(null);
  const [activeMemory, setActiveMemory] = useState<Memory | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [hintIndex, setHintIndex] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const captureRef = useRef<AudioCapture | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);
  const sessionRef = useRef<LiveSession | null>(null);
  const frameTimerRef = useRef<number | null>(null);
  const sessionTimerRef = useRef<number | null>(null);
  const userBufferRef = useRef("");
  const aiBufferRef = useRef("");
  const captionTimerRef = useRef<number | null>(null);
  const reconnectingRef = useRef(false);
  // Per-current-session elapsed seconds — used only for the failsafe reconnect
  // trigger. Not displayed (we show totalElapsed instead).
  const elapsedRef = useRef(0);
  // Latest resumable handle from the server. Persisted across reconnects so
  // the session continues seamlessly past the 2-min underlying-WS hard limit.
  const resumeHandleRef = useRef<string | undefined>(undefined);
  // Total elapsed seconds across ALL underlying sessions in this run. The
  // user perceives one continuous conversation; this is the number we show.
  const [totalElapsed, setTotalElapsed] = useState(0);
  const totalElapsedRef = useRef(0);

  /* ---------- Hint rotator ---------- */
  useEffect(() => {
    const t = window.setInterval(() => {
      setHintIndex((i) => (i + 1) % VOICE_HINTS.length);
    }, 4500);
    return () => window.clearInterval(t);
  }, []);

  /* ---------- Permissions ---------- */
  const requestPermissions = useCallback(
    async (preferredFacing: "environment" | "user" = facingMode) => {
      setStatus("requesting-permissions");
      setError(null);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: preferredFacing }, width: { ideal: 1280 } },
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1,
          },
        });
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => undefined);
        }
        setStatus("ready");
      } catch {
        setError(
          "No se pudo activar cámara o micrófono. Revisa los permisos del navegador."
        );
        setStatus("error");
      }
    },
    [facingMode]
  );

  const flipCamera = useCallback(async () => {
    const next = facingMode === "environment" ? "user" : "environment";
    setFacingMode(next);
    if (status === "live" || status === "ready") {
      const stream = streamRef.current;
      stream?.getVideoTracks().forEach((t) => t.stop());
      try {
        const newStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: next }, width: { ideal: 1280 } },
        });
        const newVideoTrack = newStream.getVideoTracks()[0];
        if (stream && newVideoTrack) {
          stream.getVideoTracks().forEach((t) => stream.removeTrack(t));
          stream.addTrack(newVideoTrack);
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            await videoRef.current.play().catch(() => undefined);
          }
        }
      } catch (e) {
        console.error("[camera] flip failed:", e);
      }
    }
  }, [facingMode, status]);

  /* ---------- TTS ---------- */
  const speakText = useCallback((text: string) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "es-ES";
    utter.rate = 0.95;
    window.speechSynthesis.speak(utter);
  }, []);

  /* ---------- Memorias persistence ---------- */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(MEMORIES_KEY);
      if (raw) setMemories(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, []);

  const persistMemories = useCallback((next: Memory[]) => {
    setMemories(next);
    try {
      localStorage.setItem(MEMORIES_KEY, JSON.stringify(next));
    } catch {
      /* quota */
    }
  }, []);

  const deleteMemory = useCallback(
    (id: string) => {
      persistMemories(memories.filter((m) => m.id !== id));
      if (activeMemory?.id === id) setActiveMemory(null);
    },
    [memories, persistMemories, activeMemory]
  );

  const speakMemory = useCallback(
    (memory: Memory) => speakText(memory.description),
    [speakText]
  );

  /* ---------- Save current frame as memory ---------- */
  const saveCurrentMoment = useCallback(async () => {
    const time = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    const label = `Memoria · ${time}`;
    setMemorySaving({ label });
    try {
      const v = videoRef.current;
      if (!v) throw new Error("Sin acceso a cámara");
      const imageBase64 = await captureFrameJpegBase64(v, 1280, 0.85);
      if (!imageBase64) throw new Error("No se pudo capturar el frame");
      const res = await fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64, mimeType: "image/jpeg", label }),
      });
      if (!res.ok) {
        const body = await res.text();
        console.error(`[memory] ${res.status}:`, body);
        throw new Error(`memory ${res.status}`);
      }
      const data = (await res.json()) as { description: string };
      const newMem: Memory = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        label,
        description: data.description,
        imageBase64,
        mimeType: "image/jpeg",
        timestamp: Date.now(),
      };
      const next = [newMem, ...memories].slice(0, MAX_MEMORIES);
      persistMemories(next);
      speakText(`Listo, guardé ${label}.`);
    } catch (e) {
      console.error("[memory] save failed:", e);
      speakText("No pude guardar la memoria");
    } finally {
      setMemorySaving(null);
    }
  }, [memories, persistMemories, speakText]);

  /* ---------- Tool calls ---------- */
  const handleToolCall = useCallback(
    async (call: FunctionCall) => {
      const id = call.id ?? "";
      const name = call.name ?? "";
      const args = (call.args ?? {}) as Record<string, unknown>;
      console.log(`%c[tool] ${name}`, "color:#60a5fa;font-weight:bold", args);

      if (name === "find_nearby_place") {
        try {
          const coords = await new Promise<GeolocationPosition | null>((resolve) => {
            if (!navigator.geolocation) return resolve(null);
            navigator.geolocation.getCurrentPosition(
              (p) => resolve(p),
              () => resolve(null),
              { timeout: 4000 }
            );
          });
          const res = await fetch("/api/nearby", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              query: args.query,
              sceneCues: args.sceneCues,
              lat: coords?.coords.latitude,
              lng: coords?.coords.longitude,
            }),
          });
          const data = (await res.json()) as { text?: string; error?: string };
          sessionRef.current?.sendToolResponse(id, name, {
            status: res.ok ? "ok" : "error",
            guidance: data.text ?? data.error ?? "",
          });
        } catch (e) {
          sessionRef.current?.sendToolResponse(id, name, {
            status: "error",
            guidance: e instanceof Error ? e.message : "fallo",
          });
        }
        return;
      }

      if (name === "save_memory") {
        const label = String(args.label ?? "Memoria sin título");
        setMemorySaving({ label });
        try {
          const v = videoRef.current;
          if (!v) throw new Error("Sin acceso a cámara");
          const imageBase64 = await captureFrameJpegBase64(v, 1280, 0.85);
          if (!imageBase64) throw new Error("No se pudo capturar frame");
          const res = await fetch("/api/memory", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ imageBase64, mimeType: "image/jpeg", label }),
          });
          if (!res.ok) throw new Error(`memory ${res.status}`);
          const data = (await res.json()) as { description: string };
          const newMem: Memory = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            label,
            description: data.description,
            imageBase64,
            mimeType: "image/jpeg",
            timestamp: Date.now(),
          };
          persistMemories([newMem, ...memories].slice(0, MAX_MEMORIES));
          sessionRef.current?.sendToolResponse(id, name, {
            status: "ok",
            message: `Memoria "${label}" guardada.`,
          });
        } catch (e) {
          sessionRef.current?.sendToolResponse(id, name, {
            status: "error",
            message: e instanceof Error ? e.message : "fallo",
          });
        } finally {
          setMemorySaving(null);
        }
        return;
      }

    },
    [memories, persistMemories]
  );

  /* ---------- Connect Session ---------- */
  const startSession = useCallback(
    async (opts?: { resume?: boolean }) => {
      const isResume = opts?.resume === true;
      setError(null);
      // On resume, keep status="live" so the UI doesn't blink. On fresh start,
      // show the connecting overlay.
      if (!isResume) {
        setStatus("connecting");
        setUserCaption("");
        setAiCaption("");
        userBufferRef.current = "";
        aiBufferRef.current = "";
        totalElapsedRef.current = 0;
        setTotalElapsed(0);
        resumeHandleRef.current = undefined;
      }

      // Tear down the OLD session/capture/player ONLY after the new session
      // has connected — but tearing down before reconnect is simpler and the
      // gap is tens of milliseconds. For now use the simple sequence; if the
      // perceived gap is annoying we can do hot-swap later.
      sessionRef.current?.close();
      captureRef.current?.stop();
      playerRef.current?.close();
      if (frameTimerRef.current) window.clearInterval(frameTimerRef.current);
      if (sessionTimerRef.current) window.clearInterval(sessionTimerRef.current);

      const player = new AudioPlayer();
      void player.resume();
      playerRef.current = player;

      try {
        const { token, model } = await fetchEphemeralToken();

        const hour = new Date().getHours();
        const tod =
          hour < 5
            ? "una linda madrugada"
            : hour < 12
              ? "un lindo día"
              : hour < 19
                ? "una linda tarde"
                : "una linda noche";
        const dynamicKickoff = `Saluda al usuario diciendo exactamente esta frase con voz cálida: "Hola, ¿cómo estás? Que tengas ${tod}. ¿Qué hacemos hoy?". Después escucha qué te dice. NO añadas más palabras al saludo.`;

        const session = new LiveSession(
          {
            token,
            model,
            systemInstruction: ASSISTANT.systemPrompt,
            tools: ASSISTANT.tools,
            kickoff: dynamicKickoff,
            // When resuming, pass the prior handle so the server restores
            // conversation state. The kickoff is suppressed inside LiveSession
            // when resumeHandle is present, so the user doesn't get re-greeted.
            resumeHandle: isResume ? resumeHandleRef.current : undefined,
          },
          {
            onOpen: () => {
              setStatus("live");
              elapsedRef.current = 0;
            },
            onAudio: (b64) => playerRef.current?.enqueueBase64(b64),
            onInputTranscription: (text) => {
              userBufferRef.current += text;
              setUserCaption(userBufferRef.current);
            },
            onOutputTranscription: (text) => {
              aiBufferRef.current += text;
              setAiCaption(aiBufferRef.current);
            },
            onTurnComplete: () => {
              if (captionTimerRef.current) window.clearTimeout(captionTimerRef.current);
              captionTimerRef.current = window.setTimeout(() => {
                userBufferRef.current = "";
                aiBufferRef.current = "";
                setUserCaption("");
                setAiCaption("");
              }, 4000);
            },
            onInterrupted: () => playerRef.current?.interrupt(),
            onToolCall: (call) => handleToolCall(call),
            onResumeHandleUpdate: (handle) => {
              resumeHandleRef.current = handle;
            },
            onGoAway: (timeLeftSec) => {
              // Server tells us the WS will die in `timeLeftSec`. Spin up a
              // resumed session NOW so the user never feels the cut.
              console.log(
                `[live] goAway received (${timeLeftSec}s) — preempting with resume`
              );
              if (resumeHandleRef.current) triggerReconnect();
            },
            onClose: () => {
              if (!reconnectingRef.current) setStatus("ended");
            },
            onError: (err) => {
              setError(err.message);
              setStatus("error");
            },
          }
        );
        await session.connect();
        sessionRef.current = session;

        const capture = new AudioCapture((samples, level) => {
          setAudioLevel(level);
          if (!muted) sessionRef.current?.sendAudio(int16ToBase64(samples), level);
        });
        await capture.start(streamRef.current ?? undefined);
        capture.setMuted(muted);
        captureRef.current = capture;

        await player.resume();

        frameTimerRef.current = window.setInterval(async () => {
          const v = videoRef.current;
          if (!v || !sessionRef.current || sessionRef.current.isClosed()) return;
          const frame = await captureFrameJpegBase64(v, 768, 0.7);
          if (frame) sessionRef.current.sendVideoFrame(frame);
        }, FRAME_INTERVAL_MS);

        sessionTimerRef.current = window.setInterval(() => {
          elapsedRef.current += 1;
          // Failsafe: if the server hasn't fired goAway by now, force a
          // resumed reconnect ourselves before the 120s hard limit.
          if (
            elapsedRef.current >= SESSION_FAILSAFE_SEC &&
            resumeHandleRef.current
          ) {
            triggerReconnect();
          }
          totalElapsedRef.current += 1;
          setTotalElapsed(totalElapsedRef.current);
        }, 1000);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setStatus("error");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [muted]
  );

  const triggerReconnect = useCallback(() => {
    if (reconnectingRef.current) return;
    reconnectingRef.current = true;
    // Don't change status — we want a transparent swap, not a connecting overlay
    setTimeout(async () => {
      await startSession({ resume: true });
      reconnectingRef.current = false;
    }, 50);
  }, [startSession]);

  /* ---------- Cleanup ---------- */
  const stopAll = useCallback(() => {
    sessionRef.current?.close();
    captureRef.current?.stop();
    playerRef.current?.close();
    if (frameTimerRef.current) window.clearInterval(frameTimerRef.current);
    if (sessionTimerRef.current) window.clearInterval(sessionTimerRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    sessionRef.current = null;
    captureRef.current = null;
    playerRef.current = null;
    streamRef.current = null;
    setStatus("ended");
    setSettingsOpen(false);
  }, []);

  useEffect(() => {
    return () => {
      sessionRef.current?.close();
      captureRef.current?.stop();
      playerRef.current?.close();
      if (frameTimerRef.current) window.clearInterval(frameTimerRef.current);
      if (sessionTimerRef.current) window.clearInterval(sessionTimerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    captureRef.current?.setMuted(muted);
  }, [muted]);

  const isLive = status === "live" || status === "reconnecting";
  const showHints = isLive && !userCaption && !aiCaption;

  /* ---------- Voice wave bars (responsive count) ---------- */
  const renderVoiceBars = (count = 12) => {
    const base = Math.min(1, audioLevel * 5);
    return (
      <div className="flex items-end gap-[3px] h-9 md:h-11">
        {Array.from({ length: count }).map((_, i) => {
          const phase = (i + 1) / count;
          const t = (Date.now() / 90 + i * 0.6) % (Math.PI * 2);
          const wave = 0.3 + Math.abs(Math.sin(t)) * 0.7;
          const h = isLive
            ? Math.max(0.18, Math.min(1, base * wave * (0.6 + phase * 0.6)))
            : 0.18;
          return (
            <span
              key={i}
              className="voice-bar"
              style={{
                height: `${h * 100}%`,
                opacity: isLive && !muted ? 0.9 : 0.35,
                transition: "height 90ms linear, opacity 200ms",
              }}
            />
          );
        })}
      </div>
    );
  };

  return (
    <main className="relative h-[100svh] w-screen overflow-hidden bg-[var(--bg)] text-white">
      {/* === Camera background gradient === */}
      <div aria-hidden className="camera-bg absolute inset-0" />

      {/* === Camera (mobile: fullscreen; desktop: contained left panel) === */}
      <div className="absolute inset-0 flex md:items-center md:justify-center md:p-8 md:pt-24 md:pb-44">
        <div className="relative h-full w-full md:max-w-[1100px] md:grid md:grid-cols-[minmax(0,1fr)_360px] md:gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
          {/* === Camera column === */}
          <div className="relative h-full w-full overflow-hidden md:rounded-2xl md:ring-1 md:ring-inset md:ring-[var(--hairline-strong)]">
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="absolute inset-0 h-full w-full object-cover"
              style={{ opacity: status === "ready" || isLive ? 0.92 : 0 }}
            />
            <div aria-hidden className="grain pointer-events-none absolute inset-0" />

            {/* Top scrim (mobile only — desktop has solid bg) */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 z-10 h-32 md:hidden"
              style={{ background: "var(--scrim-top)" }}
            />

            {/* Corner guides */}
            <span className="corner-guide tl" />
            <span className="corner-guide tr" />
            <span className="corner-guide bl" />
            <span className="corner-guide br" />

            {/* Center focus circle */}
            {isLive && !aiCaption && !userCaption && (
              <span className="focus-circle" />
            )}

            {/* === Voice wave bars (mid screen) === */}
            {isLive && (
              <div className="pointer-events-none absolute inset-x-0 top-[34%] z-15 flex justify-center md:top-[28%]">
                {renderVoiceBars(12)}
              </div>
            )}

            {/* === Voice hints when idle === */}
            {showHints && (
              <div className="pointer-events-none absolute inset-x-0 top-[48%] z-15 flex flex-col items-center gap-2 px-6">
                <span className="font-mono text-[10px] uppercase tracking-[0.32em] text-white/55">
                  prueba decir
                </span>
                <span
                  key={hintIndex}
                  className="caption-line caption-box max-w-[34ch] rounded-full px-4 py-2 text-center font-display text-[15px] font-semibold text-white md:text-[17px]"
                >
                  {VOICE_HINTS[hintIndex]}
                </span>
              </div>
            )}

            {/* === Captions === */}
            {(userCaption || aiCaption) && (
              <div className="pointer-events-none absolute inset-x-0 bottom-[200px] z-15 flex flex-col items-center gap-2 px-6 md:bottom-6">
                {userCaption && (
                  <div className="caption-box caption-line max-w-[28ch] rounded-lg px-3 py-2 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-white/80">
                    {userCaption.trim()}
                  </div>
                )}
                {aiCaption && (
                  <div
                    key={aiCaption.length}
                    className="caption-box caption-line max-w-[42ch] rounded-lg px-4 py-2.5 text-center text-[14px] font-medium leading-snug text-white md:text-[16px]"
                  >
                    {aiCaption.trim()}
                    <span className="caret" />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* === Sidebar (desktop only) === */}
          <aside className="hidden flex-col gap-4 overflow-hidden md:flex">
            <DesktopSidebar
              isLive={isLive}
              userCaption={userCaption}
              aiCaption={aiCaption}
              memories={memories}
              onMemoryClick={(m) => {
                setMemoriesOpen(true);
                setActiveMemory(m);
                speakMemory(m);
              }}
              onOpenGallery={() => setMemoriesOpen(true)}
            />
          </aside>
        </div>
      </div>

      {/* === Top nav === */}
      <header className="absolute inset-x-0 top-0 z-20 flex items-start justify-between px-4 pt-5 md:px-8 md:pt-6">
        <div className="flex items-center gap-2.5">
          <Link
            href="/"
            className="grid h-9 w-9 place-items-center rounded-[10px] bg-white/8 backdrop-blur ring-1 ring-inset ring-white/15"
            aria-label="Volver"
          >
            <IconArrowLeft size={16} stroke={2.25} />
          </Link>
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className="grid h-8 w-8 place-items-center rounded-[8px] bg-[var(--blue-900)] text-white"
            >
              <SensLogo size={18} strokeWidth={7} />
            </span>
            <span className="font-display text-[15px] font-semibold tracking-tight md:text-[17px]">
              Sens
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-black/40 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.28em] text-white/85 backdrop-blur ring-1 ring-inset ring-white/15">
            <span className="live-dot" /> en vivo
          </span>
          {isLive && (
            <span className="hidden font-mono text-[10px] tabular-nums text-white/55 md:inline">
              {formatTime(totalElapsed)}
            </span>
          )}
          <button
            onClick={() => setMemoriesOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-full bg-black/40 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.28em] text-white/85 backdrop-blur ring-1 ring-inset ring-white/15"
          >
            <IconBookmark size={12} stroke={2} />
            {memories.length > 0 ? memories.length : ""}
          </button>
        </div>
      </header>

      {/* === Mobile session timer (counts up indefinitely; reconnects are
            transparent under the hood) === */}
      {isLive && (
        <div className="pointer-events-none absolute right-4 top-[60px] z-15 md:hidden">
          <span className="font-mono text-[10px] tabular-nums text-white/55">
            {formatTime(totalElapsed)}
          </span>
        </div>
      )}

      {/* === Connecting overlay === */}
      {(status === "connecting" || status === "reconnecting") && (
        <div className="absolute inset-x-0 top-32 z-20 flex justify-center px-6">
          <div className="flex items-center gap-2.5 rounded-full bg-black/65 px-4 py-2 backdrop-blur ring-1 ring-inset ring-white/15">
            <span className="relative inline-block h-2 w-2 rounded-full bg-[var(--blue-400)] pulse-ring" />
            <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-white/85">
              {status === "reconnecting" ? "reconectando" : "conectando…"}
            </span>
          </div>
        </div>
      )}

      {/* === IDLE / READY OVERLAY === */}
      {(status === "idle" || status === "ready" || status === "requesting-permissions") && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-[var(--bg)]/95 px-6">
          <div className="reveal reveal-1 mb-5 inline-flex items-center gap-2 rounded-full bg-[var(--bg-card)] px-3 py-1 ring-1 ring-inset ring-[var(--hairline)] font-mono text-[10px] uppercase tracking-[0.28em] text-white/70">
            <IconSparkles size={11} stroke={2.5} className="text-[var(--blue-400)]" />
            preflight
          </div>
          <h2 className="reveal reveal-2 max-w-md text-center font-display text-[34px] font-black leading-[0.95] tracking-tight md:text-[44px]">
            {status === "ready"
              ? "Todo listo. Habla y Sens responde."
              : "Activa cámara y micrófono"}
          </h2>
          <p className="reveal reveal-3 mt-3 max-w-md text-center text-[14px] leading-snug text-white/65 md:text-[16px]">
            {status === "ready"
              ? "Sens entiende tu voz y decide qué hacer: describir, leer, encontrar lugares, guardar memorias o llamar."
              : "Sens necesita ver y oír para asistirte. Tus datos no se guardan en la nube."}
          </p>

          <div className="reveal reveal-4 mt-8 flex w-full max-w-md flex-col gap-3">
            {status !== "ready" && (
              <button
                onClick={() => requestPermissions()}
                disabled={status === "requesting-permissions"}
                className="flex h-14 items-center justify-between rounded-2xl bg-[var(--blue-600)] px-5 text-white shadow-[0_8px_28px_-8px_rgba(37,99,235,0.65)] transition active:scale-[0.99] disabled:opacity-60"
              >
                <span className="font-display text-[17px] font-bold">
                  {status === "requesting-permissions" ? "Solicitando…" : "Activar permisos"}
                </span>
                <IconPlayerPlayFilled size={18} />
              </button>
            )}
            {status === "ready" && (
              <button
                onClick={() => startSession()}
                className="flex h-14 items-center justify-between rounded-2xl bg-[var(--blue-600)] px-5 text-white shadow-[0_8px_28px_-8px_rgba(37,99,235,0.65)] transition active:scale-[0.99]"
              >
                <span className="font-display text-[17px] font-bold">Iniciar sesión</span>
                <IconPlayerPlayFilled size={18} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* === ERROR OVERLAY === */}
      {status === "error" && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-[var(--bg)]/95 px-6">
          <div className="card w-full max-w-md p-6">
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-[var(--warn)]">
              error
            </p>
            <p className="mt-2 font-display text-[20px] font-bold leading-tight">
              {error ?? "Algo salió mal"}
            </p>
            <button
              onClick={() => startSession()}
              className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--blue-600)] font-bold text-white"
            >
              <IconRefresh size={16} stroke={2.25} />
              Reintentar
            </button>
          </div>
        </div>
      )}

      {/* === Saving toast === */}
      {memorySaving && (
        <div className="pointer-events-none absolute inset-x-0 top-32 z-30 flex justify-center px-6">
          <div className="flex items-center gap-2.5 rounded-full bg-[var(--bg-card)] px-4 py-2 backdrop-blur ring-1 ring-inset ring-[var(--hairline-strong)]">
            <span className="relative inline-block h-2 w-2 rounded-full bg-[var(--blue-400)] pulse-ring" />
            <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-white/85">
              guardando · {memorySaving.label}
            </span>
          </div>
        </div>
      )}

      {/* === BOTTOM CONTROLS === */}
      <footer
        className="absolute inset-x-0 bottom-0 z-20 px-4 pb-5 pt-3 md:px-8 md:pb-6"
        style={{ background: "var(--bg-overlay)", backdropFilter: "blur(12px)" }}
      >
        <div className="mx-auto flex max-w-[480px] items-center justify-between md:max-w-[1100px]">
          <button
            disabled={!isLive}
            onClick={() => setSettingsOpen(true)}
            className="grid h-12 w-12 place-items-center rounded-full bg-white/8 text-white/85 ring-1 ring-inset ring-white/15 transition disabled:opacity-30 active:bg-white/15 md:h-14 md:w-14"
            aria-label="Ajustes"
          >
            <IconSettings size={20} stroke={1.85} />
          </button>

          <button
            disabled={!isLive}
            onClick={() => setMuted((m) => !m)}
            className={`relative grid h-[78px] w-[78px] place-items-center rounded-full transition disabled:opacity-30 active:scale-[0.97] md:h-[88px] md:w-[88px] ${
              muted ? "bg-[var(--warn)] text-white" : "bg-white text-[var(--bg)]"
            }`}
            aria-label={muted ? "Activar mic" : "Silenciar mic"}
          >
            {!muted && isLive && <span className="halo" aria-hidden />}
            {muted ? (
              <IconMicrophoneOff size={32} stroke={2} />
            ) : (
              <IconMicrophone size={32} stroke={2} />
            )}
          </button>

          <button
            disabled={!isLive || !!memorySaving}
            onClick={() => void saveCurrentMoment()}
            className="relative grid h-12 w-12 place-items-center rounded-full bg-[var(--blue-900)]/60 text-[var(--blue-300)] ring-1 ring-inset ring-[var(--hairline-strong)] transition disabled:opacity-30 active:bg-[var(--blue-700)]/60 md:h-14 md:w-14"
            aria-label="Guardar momento"
          >
            <IconBookmarkPlus size={20} stroke={1.85} />
          </button>
        </div>
      </footer>

      {/* === Settings sheet === */}
      {settingsOpen && (
        <div
          className="absolute inset-0 z-50 flex items-end bg-black/55 backdrop-blur-sm md:items-center md:justify-center md:p-8"
          onClick={() => setSettingsOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full rounded-t-3xl bg-[var(--bg-card)] p-5 ring-1 ring-inset ring-[var(--hairline-strong)] md:max-w-md md:rounded-3xl"
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/15 md:hidden" />
            <h3 className="font-display text-[18px] font-black">Ajustes</h3>
            <div className="mt-4 space-y-2">
              <button
                onClick={() => {
                  setSettingsOpen(false);
                  setMemoriesOpen(true);
                }}
                className="flex w-full items-center justify-between rounded-xl bg-white/5 px-4 py-3 ring-1 ring-inset ring-[var(--hairline)]"
              >
                <span className="flex items-center gap-2.5">
                  <IconBookmark size={16} stroke={1.85} className="text-[var(--blue-300)]" />
                  <span className="font-display text-[14px] font-semibold">
                    Mis memorias
                  </span>
                </span>
                <span className="font-mono text-[10px] tabular-nums text-white/45">
                  {memories.length}
                </span>
              </button>
              <button
                onClick={() => {
                  setSettingsOpen(false);
                  void flipCamera();
                }}
                className="flex w-full items-center gap-2.5 rounded-xl bg-white/5 px-4 py-3 ring-1 ring-inset ring-[var(--hairline)]"
              >
                <IconCameraRotate size={16} stroke={1.85} className="text-[var(--blue-300)]" />
                <span className="font-display text-[14px] font-semibold">
                  Cambiar cámara
                </span>
              </button>
              <button
                onClick={stopAll}
                className="flex w-full items-center gap-2.5 rounded-xl bg-[var(--warn)]/15 px-4 py-3 ring-1 ring-inset ring-[var(--warn)]/30 text-[var(--warn)]"
              >
                <IconPlayerStopFilled size={14} />
                <span className="font-display text-[14px] font-semibold">
                  Detener sesión
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* === Memorias overlay === */}
      {memoriesOpen && (
        <div className="absolute inset-0 z-50 flex flex-col bg-[var(--bg)]">
          <header className="flex items-center justify-between border-b border-[var(--hairline)] px-4 py-4 md:px-8">
            <button
              onClick={() => {
                setMemoriesOpen(false);
                setActiveMemory(null);
                if (typeof window !== "undefined") window.speechSynthesis?.cancel();
              }}
              className="grid h-9 w-9 place-items-center rounded-full bg-white/5 ring-1 ring-inset ring-[var(--hairline)]"
              aria-label="Volver"
            >
              <IconArrowLeft size={16} stroke={2} />
            </button>
            <div className="text-center">
              <span className="font-mono text-[9px] uppercase tracking-[0.32em] text-white/55">
                galería
              </span>
              <h2 className="font-display text-[16px] font-black tracking-tight md:text-[18px]">
                Mis memorias
              </h2>
            </div>
            <span className="font-mono text-[10px] tabular-nums text-white/55">
              {memories.length}/{MAX_MEMORIES}
            </span>
          </header>

          <div className="flex-1 overflow-y-auto px-4 py-4 md:px-8">
            {!activeMemory && isLive && (
              <button
                onClick={() => void saveCurrentMoment()}
                className="mb-4 flex w-full max-w-2xl mx-auto items-center gap-3 rounded-2xl bg-[var(--blue-600)] px-4 py-3.5 text-white shadow-[0_8px_24px_-8px_rgba(37,99,235,0.55)] transition active:scale-[0.99]"
              >
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/20">
                  <IconBookmarkPlus size={18} stroke={2} />
                </span>
                <span className="text-left">
                  <div className="font-display text-[14px] font-bold">
                    Guardar este momento
                  </div>
                  <div className="text-[11px] text-white/80">
                    Captura el frame actual con descripción detallada
                  </div>
                </span>
              </button>
            )}

            {memories.length === 0 && (
              <div className="flex h-[60vh] flex-col items-center justify-center px-8 text-center text-white/45">
                <IconBookmark size={48} stroke={1.5} className="text-white/25" />
                <p className="mt-4 max-w-xs font-display text-[15px] leading-snug">
                  Aún no tienes memorias. Toca{" "}
                  <span className="text-[var(--blue-300)]">Guardar este momento</span>{" "}
                  para empezar.
                </p>
              </div>
            )}

            {memories.length > 0 && !activeMemory && (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4 lg:grid-cols-5">
                {memories.map((m) => {
                  const date = new Date(m.timestamp);
                  return (
                    <button
                      key={m.id}
                      onClick={() => {
                        setActiveMemory(m);
                        speakMemory(m);
                      }}
                      className="card group relative flex flex-col overflow-hidden text-left transition hover:ring-[var(--blue-500)]/50"
                    >
                      <div className="aspect-square w-full overflow-hidden">
                        <img
                          src={`data:${m.mimeType};base64,${m.imageBase64}`}
                          alt={m.label}
                          className="block h-full w-full object-cover"
                        />
                      </div>
                      <div className="px-3 py-2.5">
                        <p className="font-display text-[12px] font-bold leading-tight line-clamp-2">
                          {m.label}
                        </p>
                        <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.22em] text-white/45">
                          {date.toLocaleDateString()} ·{" "}
                          {date.toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {activeMemory && (
              <div className="mx-auto max-w-2xl">
                <button
                  onClick={() => {
                    setActiveMemory(null);
                    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
                  }}
                  className="mb-4 inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.32em] text-white/65"
                >
                  <IconArrowLeft size={12} stroke={2.25} />
                  todas las memorias
                </button>
                <div className="card overflow-hidden">
                  <img
                    src={`data:${activeMemory.mimeType};base64,${activeMemory.imageBase64}`}
                    alt={activeMemory.label}
                    className="block w-full"
                  />
                </div>
                <h3 className="mt-5 font-display text-[22px] font-black leading-tight md:text-[26px]">
                  {activeMemory.label}
                </h3>
                <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.28em] text-white/55">
                  {new Date(activeMemory.timestamp).toLocaleString()}
                </p>
                <p className="mt-4 text-[14px] leading-relaxed text-white/85 md:text-[15px]">
                  {activeMemory.description}
                </p>
                <div className="mt-6 flex gap-3">
                  <button
                    onClick={() => speakMemory(activeMemory)}
                    className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--blue-600)] font-display font-bold text-white"
                  >
                    <IconPlayerPlayFilled size={16} />
                    Reescuchar
                  </button>
                  <button
                    onClick={() => deleteMemory(activeMemory.id)}
                    className="grid h-12 w-12 place-items-center rounded-xl bg-[var(--warn)]/15 text-[var(--warn)] ring-1 ring-inset ring-[var(--warn)]/30"
                    aria-label="Eliminar memoria"
                  >
                    <IconTrash size={16} stroke={2} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

/* === Desktop sidebar — conversation log + recent memories === */
function DesktopSidebar({
  isLive,
  userCaption,
  aiCaption,
  memories,
  onMemoryClick,
  onOpenGallery,
}: {
  isLive: boolean;
  userCaption: string;
  aiCaption: string;
  memories: Memory[];
  onMemoryClick: (m: Memory) => void;
  onOpenGallery: () => void;
}) {
  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden">
      {/* Conversation panel */}
      <div className="card flex flex-1 min-h-0 flex-col p-5">
        <div className="mb-3 flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.32em] text-white/55">
            conversación
          </span>
          {isLive && (
            <span className="inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.28em] text-white/65">
              <span className="live-dot" />
              activa
            </span>
          )}
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto">
          {!userCaption && !aiCaption && (
            <div className="flex h-full flex-col items-center justify-center text-center text-white/40">
              <IconMicrophone size={32} stroke={1.5} className="text-white/25" />
              <p className="mt-3 max-w-[26ch] font-display text-[14px] leading-tight">
                Cuando hables, tu conversación con Sens aparecerá aquí.
              </p>
            </div>
          )}
          {userCaption && (
            <div>
              <span className="font-mono text-[9px] uppercase tracking-[0.28em] text-white/45">
                tú
              </span>
              <p className="mt-1 text-[14px] leading-snug text-white/80">
                {userCaption.trim()}
              </p>
            </div>
          )}
          {aiCaption && (
            <div>
              <span className="font-mono text-[9px] uppercase tracking-[0.28em] text-[var(--blue-300)]">
                sens
              </span>
              <p className="mt-1 text-[15px] font-medium leading-snug text-white">
                {aiCaption.trim()}
                <span className="caret" />
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Memorias preview */}
      <div className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.32em] text-white/55">
            memorias recientes
          </span>
          <button
            onClick={onOpenGallery}
            className="font-mono text-[9px] uppercase tracking-[0.28em] text-[var(--blue-300)] hover:text-[var(--blue-400)]"
          >
            ver todas
          </button>
        </div>
        {memories.length === 0 ? (
          <p className="text-[12px] leading-snug text-white/45">
            Di &quot;guarda esto&quot; o toca el botón de bookmark para guardar
            un frame.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {memories.slice(0, 3).map((m) => (
              <button
                key={m.id}
                onClick={() => onMemoryClick(m)}
                className="aspect-square overflow-hidden rounded-lg ring-1 ring-inset ring-[var(--hairline)] transition hover:ring-[var(--blue-500)]"
              >
                <img
                  src={`data:${m.mimeType};base64,${m.imageBase64}`}
                  alt={m.label}
                  className="block h-full w-full object-cover"
                />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

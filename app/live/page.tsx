"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AudioCapture,
  AudioPlayer,
  captureFrameJpegBase64,
  int16ToBase64,
} from "@/lib/audio";
import { LiveSession, fetchEphemeralToken } from "@/lib/gemini-live";
import { ALL_MODES, MODES, type ModeId } from "@/lib/modes";
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

interface VisualOverlay {
  mimeType: string;
  dataBase64: string;
  caption: string;
}

const SESSION_LIMIT_SEC = 110;
const FRAME_INTERVAL_MS = 1000;

function formatTime(s: number) {
  const m = Math.floor(s / 60).toString().padStart(2, "0");
  const sec = (s % 60).toString().padStart(2, "0");
  return `${m}:${sec}`;
}

export default function LivePage() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ModeId>("eyes");
  const [userCaption, setUserCaption] = useState("");
  const [aiCaption, setAiCaption] = useState("");
  const [visual, setVisual] = useState<VisualOverlay | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [muted, setMuted] = useState(false);

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
  const pendingModeRef = useRef<ModeId | null>(null);
  const reconnectingRef = useRef(false);

  const currentMode = MODES[mode];

  /* ---------- Permissions ---------- */
  const requestPermissions = useCallback(async () => {
    setStatus("requesting-permissions");
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => undefined);
      }
      setStatus("ready");
    } catch (e) {
      setError(
        "No se pudo activar cámara o micrófono. Revisa los permisos del navegador."
      );
      setStatus("error");
    }
  }, []);

  /* ---------- Connect Session ---------- */
  const startSession = useCallback(
    async (targetMode: ModeId) => {
      setError(null);
      setStatus("connecting");
      setUserCaption("");
      setAiCaption("");
      userBufferRef.current = "";
      aiBufferRef.current = "";

      // Tear down any existing
      sessionRef.current?.close();
      captureRef.current?.stop();
      playerRef.current?.close();
      if (frameTimerRef.current) window.clearInterval(frameTimerRef.current);
      if (sessionTimerRef.current) window.clearInterval(sessionTimerRef.current);

      try {
        const { token, model } = await fetchEphemeralToken();
        const cfg = MODES[targetMode];
        const session = new LiveSession(
          {
            token,
            model,
            systemInstruction: cfg.systemPrompt,
            tools: cfg.tools,
            kickoff:
              "Saluda al usuario en una sola frase corta de 6-8 palabras: 'Hola, soy AccessLens, ¿en qué te ayudo?'",
          },
          {
            onOpen: () => {
              setStatus("live");
              setElapsed(0);
            },
            onAudio: (b64) => {
              playerRef.current?.enqueueBase64(b64);
            },
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
            onInterrupted: () => {
              playerRef.current?.interrupt();
            },
            onToolCall: (call) => handleToolCall(call),
            onClose: (reason) => {
              if (!reconnectingRef.current && pendingModeRef.current === null) {
                setStatus("ended");
              }
            },
            onError: (err) => {
              setError(err.message);
              setStatus("error");
            },
          }
        );
        await session.connect();
        sessionRef.current = session;

        // Audio capture
        const capture = new AudioCapture((samples, level) => {
          setAudioLevel(level);
          if (!muted) sessionRef.current?.sendAudio(int16ToBase64(samples), level);
        });
        await capture.start();
        capture.setMuted(muted);
        captureRef.current = capture;

        // Audio player
        const player = new AudioPlayer();
        await player.resume();
        playerRef.current = player;

        // Video frame loop
        frameTimerRef.current = window.setInterval(async () => {
          const v = videoRef.current;
          if (!v || !sessionRef.current || sessionRef.current.isClosed()) return;
          const frame = await captureFrameJpegBase64(v, 768, 0.7);
          if (frame) sessionRef.current.sendVideoFrame(frame);
        }, FRAME_INTERVAL_MS);

        // Session timer (auto-reconnect at limit)
        sessionTimerRef.current = window.setInterval(() => {
          setElapsed((prev) => {
            const next = prev + 1;
            if (next >= SESSION_LIMIT_SEC) {
              triggerReconnect(targetMode);
            }
            return next;
          });
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

  /* ---------- Tool calls ---------- */
  const handleToolCall = useCallback(async (call: FunctionCall) => {
    const id = call.id ?? "";
    const name = call.name ?? "";
    const args = (call.args ?? {}) as Record<string, unknown>;

    if (name === "generate_visual_aid") {
      const description = String(args.description ?? "");
      const caption = String(args.caption ?? "");
      try {
        const res = await fetch("/api/visual", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ description }),
        });
        if (!res.ok) throw new Error(`visual ${res.status}`);
        const data = (await res.json()) as { mimeType: string; dataBase64: string };
        setVisual({ mimeType: data.mimeType, dataBase64: data.dataBase64, caption });
        sessionRef.current?.sendToolResponse(id, name, {
          status: "ok",
          message: "Imagen generada y mostrada al usuario.",
        });
      } catch (e) {
        sessionRef.current?.sendToolResponse(id, name, {
          status: "error",
          message: e instanceof Error ? e.message : "fallo",
        });
      }
      return;
    }

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
    }
  }, []);

  /* ---------- Reconnect (session 2-min limit) ---------- */
  const triggerReconnect = useCallback(
    (targetMode: ModeId) => {
      if (reconnectingRef.current) return;
      reconnectingRef.current = true;
      setStatus("reconnecting");
      setTimeout(async () => {
        await startSession(targetMode);
        reconnectingRef.current = false;
      }, 200);
    },
    [startSession]
  );

  /* ---------- Mode switch ---------- */
  const switchMode = useCallback(
    async (next: ModeId) => {
      if (next === mode && status === "live") return;
      pendingModeRef.current = next;
      setMode(next);
      if (status === "live" || status === "connecting" || status === "reconnecting") {
        await startSession(next);
      }
      pendingModeRef.current = null;
    },
    [mode, status, startSession]
  );

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

  /* ---------- VU meter values (8 bars, deterministic from level) ---------- */
  const bars = useMemo(() => {
    const base = Math.min(1, audioLevel * 6);
    return Array.from({ length: 8 }, (_, i) => {
      const phase = (i + 1) / 8;
      return Math.max(0.12, Math.min(1, base * (0.6 + Math.sin(Date.now() / 80 + i) * 0.4) * phase));
    });
  }, [audioLevel]);

  const isLive = status === "live" || status === "reconnecting";

  return (
    <main className="relative h-[100svh] w-screen overflow-hidden bg-black text-white">
      {/* Camera */}
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div aria-hidden className="grain pointer-events-none absolute inset-0" />

      {/* Top scrim */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-44"
        style={{ background: "var(--scrim-top)" }}
      />
      {/* Bottom scrim */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-72"
        style={{ background: "var(--scrim-bottom)" }}
      />

      {/* Frame corners */}
      <span className="frame-corner tl" />
      <span className="frame-corner tr" />
      <span className="frame-corner bl" />
      <span className="frame-corner br" />

      {/* Top bar */}
      <header className="absolute inset-x-0 top-0 z-20 flex items-start justify-between px-5 pt-7">
        <Link
          href="/"
          className="hairline-strong flex h-9 items-center gap-2 bg-black/50 px-3 backdrop-blur"
        >
          <span className="font-mono text-sm">←</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.32em] text-white/80">
            exit
          </span>
        </Link>

        <div className="flex flex-col items-center">
          <span className="font-mono text-[10px] uppercase tracking-[0.32em] text-white/60">
            mode
          </span>
          <div className="mt-1 flex items-center gap-2 bg-[var(--signal)] px-3 py-1 text-[var(--signal-ink)]">
            <span className="text-base">{currentMode.emoji}</span>
            <span className="font-display text-sm font-bold uppercase tracking-wider">
              {currentMode.label}
            </span>
          </div>
        </div>

        <div className="flex flex-col items-end">
          <span className="font-mono text-[10px] uppercase tracking-[0.32em] text-white/60">
            session
          </span>
          <span
            className={`mt-1 font-mono text-sm tabular-nums ${
              elapsed > SESSION_LIMIT_SEC - 15 && isLive
                ? "text-[var(--warn)]"
                : "text-white"
            }`}
          >
            {formatTime(Math.min(elapsed, SESSION_LIMIT_SEC))} / 01:50
          </span>
        </div>
      </header>

      {/* IDLE / READY OVERLAY */}
      {(status === "idle" || status === "ready" || status === "requesting-permissions") && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/80 px-6">
          <div className="reveal reveal-1 mb-6 inline-flex items-center gap-2 border border-[var(--hairline-strong)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.28em] text-white/70">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--signal)]" />
            preflight
          </div>
          <h2 className="reveal reveal-2 max-w-md text-center font-display text-4xl font-black leading-tight tracking-tight">
            {status === "ready"
              ? "Listo. Elige un modo y arranca."
              : "Activa cámara y micrófono"}
          </h2>
          <p className="reveal reveal-3 mt-4 max-w-md text-center text-white/70">
            {status === "ready"
              ? "AccessLens verá lo mismo que tú y te hablará con voz natural."
              : "AccessLens necesita ver y oír para asistirte. Tus datos no se guardan."}
          </p>

          <div className="reveal reveal-4 mt-9 flex w-full max-w-md flex-col gap-3">
            {status !== "ready" && (
              <button
                onClick={requestPermissions}
                disabled={status === "requesting-permissions"}
                className="flex h-14 items-center justify-between bg-[var(--signal)] px-5 text-[var(--signal-ink)] disabled:opacity-50"
              >
                <span className="font-display text-lg font-bold">
                  {status === "requesting-permissions" ? "Solicitando..." : "Activar permisos"}
                </span>
                <span className="font-mono">▶</span>
              </button>
            )}
            {status === "ready" && (
              <button
                onClick={() => startSession(mode)}
                className="flex h-14 items-center justify-between bg-[var(--signal)] px-5 text-[var(--signal-ink)]"
              >
                <span className="font-display text-lg font-bold">
                  Iniciar sesión Live
                </span>
                <span className="font-mono">▶</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* CONNECTING / RECONNECTING OVERLAY */}
      {(status === "connecting" || status === "reconnecting") && (
        <div className="absolute inset-x-0 top-24 z-20 flex justify-center">
          <div className="hairline-strong flex items-center gap-3 bg-black/70 px-4 py-2 backdrop-blur">
            <span className="relative inline-block h-2 w-2 rounded-full bg-[var(--signal)] pulse-ring" />
            <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-white/80">
              {status === "reconnecting" ? "reconectando" : "conectando…"}
            </span>
          </div>
        </div>
      )}

      {/* ERROR OVERLAY */}
      {status === "error" && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/85 px-6">
          <div className="hairline-strong w-full max-w-md bg-black p-6">
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-[var(--warn)]">
              error
            </p>
            <p className="mt-2 font-display text-2xl font-bold leading-tight">
              {error ?? "Algo salió mal"}
            </p>
            <button
              onClick={() => startSession(mode)}
              className="mt-5 flex h-12 w-full items-center justify-center bg-[var(--signal)] font-bold text-[var(--signal-ink)]"
            >
              Reintentar
            </button>
          </div>
        </div>
      )}

      {/* Captions */}
      {(userCaption || aiCaption) && (
        <div className="pointer-events-none absolute inset-x-0 bottom-56 z-10 flex flex-col items-center gap-3 px-6">
          {userCaption && (
            <p className="caption-line max-w-[28ch] bg-black/55 px-3 py-1.5 text-center text-base font-medium text-white/85 backdrop-blur-sm">
              {userCaption.trim()}
            </p>
          )}
          {aiCaption && (
            <p
              className="caption-line max-w-[34ch] text-center font-display text-2xl font-bold leading-snug tracking-tight text-[var(--signal)] [text-shadow:0_2px_18px_rgba(0,0,0,0.85)]"
              key={aiCaption.length}
            >
              {aiCaption.trim()}
            </p>
          )}
        </div>
      )}

      {/* Visual overlay */}
      {visual && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-black/90 px-4">
          <div className="grain relative w-full max-w-md overflow-hidden hairline-strong bg-black">
            <img
              src={`data:${visual.mimeType};base64,${visual.dataBase64}`}
              alt="Visual generado por AccessLens"
              className="block h-auto w-full"
            />
          </div>
          <p className="mt-4 max-w-md text-center font-display text-base text-white/80">
            {visual.caption}
          </p>
          <button
            onClick={() => setVisual(null)}
            className="mt-6 bg-[var(--signal)] px-6 py-3 font-display font-bold text-[var(--signal-ink)]"
          >
            Cerrar visual
          </button>
        </div>
      )}

      {/* Bottom controls */}
      <footer className="absolute inset-x-0 bottom-0 z-20 px-5 pb-6 pt-3">
        {/* VU + mute */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-end gap-[3px] h-7">
            {bars.map((v, i) => (
              <span
                key={i}
                className="block w-[4px] origin-bottom bg-[var(--signal)]"
                style={{
                  height: `${Math.max(10, v * 100)}%`,
                  opacity: isLive && !muted ? 1 : 0.25,
                  transition: "height 80ms linear, opacity 200ms",
                }}
              />
            ))}
          </div>
          <button
            onClick={() => setMuted((m) => !m)}
            className={`hairline-strong flex h-9 items-center gap-2 px-3 backdrop-blur ${
              muted ? "bg-[var(--warn)] text-black" : "bg-black/40 text-white/90"
            }`}
          >
            <span className="font-mono text-xs">{muted ? "●" : "○"}</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.28em]">
              {muted ? "mic off" : "mic on"}
            </span>
          </button>
        </div>

        {/* Mode chips */}
        <div className="grid grid-cols-4 gap-2">
          {ALL_MODES.map((m) => {
            const active = m.id === mode;
            return (
              <button
                key={m.id}
                onClick={() => switchMode(m.id)}
                className={`group relative flex flex-col items-center justify-center border px-2 py-3 text-center transition ${
                  active
                    ? "border-[var(--signal)] bg-[var(--signal)] text-[var(--signal-ink)]"
                    : "border-[var(--hairline-strong)] bg-black/55 text-white backdrop-blur"
                }`}
              >
                <span className="text-2xl leading-none">{m.emoji}</span>
                <span className="mt-1 font-display text-[12px] font-bold uppercase tracking-wider">
                  {m.label}
                </span>
                <span
                  className={`mt-0.5 hidden font-mono text-[9px] uppercase tracking-[0.18em] ${
                    active ? "text-[var(--signal-ink)]/80" : "text-white/55"
                  } sm:block`}
                >
                  0{ALL_MODES.indexOf(m) + 1}
                </span>
              </button>
            );
          })}
        </div>

        {/* Stop button (only when live) */}
        {isLive && (
          <button
            onClick={stopAll}
            className="mt-3 flex h-11 w-full items-center justify-center gap-2 bg-black/55 backdrop-blur hairline-strong"
          >
            <span className="font-mono text-xs text-[var(--warn)]">■</span>
            <span className="font-mono text-[11px] uppercase tracking-[0.32em] text-white/85">
              detener sesión
            </span>
          </button>
        )}
      </footer>
    </main>
  );
}

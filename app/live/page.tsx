"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Bookmark,
  ChevronRight,
  Eye,
  MapPin,
  Mic,
  MicOff,
  Palette,
  Play,
  RotateCcw,
  Save,
  Square,
  X,
} from "lucide-react";
import {
  AudioCapture,
  AudioPlayer,
  captureFrameJpegBase64,
  int16ToBase64,
} from "@/lib/audio";
import { LiveSession, fetchEphemeralToken } from "@/lib/gemini-live";
import { ASSISTANT, SUGGESTIONS } from "@/lib/modes";
import type { FunctionCall } from "@google/genai";

const CHIP_ICONS: Record<string, React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>> = {
  describe: Eye,
  draw: Palette,
  find: MapPin,
  remember: Save,
};

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

interface Memory {
  id: string;
  label: string;
  description: string;
  imageBase64: string;
  mimeType: string;
  timestamp: number;
}

const SESSION_LIMIT_SEC = 110;
const FRAME_INTERVAL_MS = 1000;
const MEMORIES_KEY = "accesslens:memories";
const MAX_MEMORIES = 20;

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
  const [visual, setVisual] = useState<VisualOverlay | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [muted, setMuted] = useState(false);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [memoriesOpen, setMemoriesOpen] = useState(false);
  const [memorySaving, setMemorySaving] = useState<{ label: string } | null>(null);
  const [activeMemory, setActiveMemory] = useState<Memory | null>(null);
  const [actionToast, setActionToast] = useState<string | null>(null);

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
    async () => {
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

      // CRITICAL for iOS Safari: create + resume the AudioPlayer synchronously inside the
      // user-gesture chain (before any await). Once we hit `await fetchEphemeralToken()` the
      // gesture flag is gone and `new AudioContext()` would start in 'interrupted' state.
      const player = new AudioPlayer();
      void player.resume();
      playerRef.current = player;

      try {
        const { token, model } = await fetchEphemeralToken();
        const session = new LiveSession(
          {
            token,
            model,
            systemInstruction: ASSISTANT.systemPrompt,
            tools: ASSISTANT.tools,
            kickoff: ASSISTANT.kickoff,
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
            onClose: () => {
              if (!reconnectingRef.current) {
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

        // Audio capture — reuse the camera+mic MediaStream opened by requestPermissions
        // (which already has echoCancellation: true). Opening a second getUserMedia call
        // here was causing the speaker -> mic feedback that triggered server VAD interrupts.
        const capture = new AudioCapture((samples, level) => {
          setAudioLevel(level);
          if (!muted) sessionRef.current?.sendAudio(int16ToBase64(samples), level);
        });
        await capture.start(streamRef.current ?? undefined);
        capture.setMuted(muted);
        captureRef.current = capture;

        // (player was created above, before the awaits, so iOS Safari keeps it unlocked)
        await player.resume();

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
              triggerReconnect();
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

  /* ---------- Memorias persistence ---------- */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(MEMORIES_KEY);
      if (raw) setMemories(JSON.parse(raw));
    } catch {
      /* ignore corrupt storage */
    }
  }, []);

  const persistMemories = useCallback((next: Memory[]) => {
    setMemories(next);
    try {
      localStorage.setItem(MEMORIES_KEY, JSON.stringify(next));
    } catch {
      /* quota exceeded — silently drop */
    }
  }, []);

  const deleteMemory = useCallback(
    (id: string) => {
      persistMemories(memories.filter((m) => m.id !== id));
      if (activeMemory?.id === id) setActiveMemory(null);
    },
    [memories, persistMemories, activeMemory]
  );

  const speakMemory = useCallback((memory: Memory) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(memory.description);
    utter.lang = "es-ES";
    utter.rate = 0.95;
    window.speechSynthesis.speak(utter);
  }, []);

  /* ---------- dispatch_action handler ---------- */
  const runAction = useCallback(
    (
      action: string,
      phone: string,
      message: string,
      delayMinutes: number
    ): { ok: boolean; detail: string } => {
      const phoneClean = phone.replace(/[^+\d]/g, "");
      if (action === "call" && phoneClean) {
        window.location.href = `tel:${phoneClean}`;
        setActionToast(`Abriendo marcador → ${phoneClean}`);
        return { ok: true, detail: "Marcador abierto" };
      }
      if (action === "sms" && phoneClean) {
        const body = encodeURIComponent(message);
        window.location.href = `sms:${phoneClean}${body ? `?body=${body}` : ""}`;
        setActionToast(`Abriendo SMS → ${phoneClean}`);
        return { ok: true, detail: "App de SMS abierta" };
      }
      if (action === "alarm" && delayMinutes > 0) {
        const ms = delayMinutes * 60 * 1000;
        const fireAlarm = () => {
          if ("Notification" in window && Notification.permission === "granted") {
            new Notification("AccessLens — recordatorio", {
              body: message || "Es hora",
            });
          } else {
            alert(`AccessLens recordatorio: ${message || "Es hora"}`);
          }
        };
        if ("Notification" in window && Notification.permission !== "granted") {
          Notification.requestPermission().then(() => {
            window.setTimeout(fireAlarm, ms);
          });
        } else {
          window.setTimeout(fireAlarm, ms);
        }
        setActionToast(`Alarma programada en ${delayMinutes} min`);
        return { ok: true, detail: `Alarma en ${delayMinutes} min` };
      }
      if (action === "share") {
        const shareData: ShareData = {
          title: "AccessLens",
          text: message || "Comparto desde AccessLens",
        };
        if (navigator.share) {
          navigator.share(shareData).catch(() => undefined);
          setActionToast("Compartiendo…");
          return { ok: true, detail: "Diálogo de compartir abierto" };
        }
        return { ok: false, detail: "Este navegador no soporta compartir" };
      }
      return { ok: false, detail: "Acción no soportada o parámetros faltantes" };
    },
    []
  );

  useEffect(() => {
    if (!actionToast) return;
    const t = window.setTimeout(() => setActionToast(null), 3000);
    return () => window.clearTimeout(t);
  }, [actionToast]);

  /* ---------- Tool calls ---------- */
  const handleToolCall = useCallback(async (call: FunctionCall) => {
    const id = call.id ?? "";
    const name = call.name ?? "";
    const args = (call.args ?? {}) as Record<string, unknown>;
    console.log(`%c[tool] ${name}`, "color:#ffe600;font-weight:bold", args);

    if (name === "generate_visual_aid") {
      const description = String(args.description ?? "");
      const caption = String(args.caption ?? "");
      try {
        const res = await fetch("/api/visual", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ description }),
        });
        if (!res.ok) {
          const err = await res.text();
          console.error(`[tool] visual endpoint ${res.status}: ${err}`);
          throw new Error(`visual ${res.status}`);
        }
        const data = (await res.json()) as { mimeType: string; dataBase64: string };
        console.log(`[tool] visual generated, mimeType=${data.mimeType}, size=${data.dataBase64.length}b64`);
        setVisual({ mimeType: data.mimeType, dataBase64: data.dataBase64, caption });
        sessionRef.current?.sendToolResponse(id, name, {
          status: "ok",
          message: "Imagen generada y mostrada al usuario en pantalla.",
        });
      } catch (e) {
        console.error("[tool] visual failed:", e);
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
        console.log(
          `[tool] nearby ${res.status}, gps=${coords ? "yes" : "no"}, response="${(data.text ?? data.error ?? "").slice(0, 80)}…"`
        );
        sessionRef.current?.sendToolResponse(id, name, {
          status: res.ok ? "ok" : "error",
          guidance: data.text ?? data.error ?? "",
        });
      } catch (e) {
        console.error("[tool] nearby failed:", e);
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
          body: JSON.stringify({
            imageBase64,
            mimeType: "image/jpeg",
            label,
          }),
        });
        if (!res.ok) {
          const err = await res.text();
          console.error(`[tool] memory endpoint ${res.status}: ${err}`);
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
        console.log(`[tool] memory saved: "${label}", ${data.description.length} chars`);
        sessionRef.current?.sendToolResponse(id, name, {
          status: "ok",
          message: `Memoria "${label}" guardada con descripción detallada.`,
        });
      } catch (e) {
        console.error("[tool] save_memory failed:", e);
        sessionRef.current?.sendToolResponse(id, name, {
          status: "error",
          message: e instanceof Error ? e.message : "fallo",
        });
      } finally {
        setMemorySaving(null);
      }
      return;
    }

    if (name === "dispatch_action") {
      const action = String(args.action ?? "").toLowerCase();
      const phone = String(args.phone ?? "");
      const message = String(args.message ?? "");
      const delayMinutes = Number(args.delayMinutes ?? 0);
      const result = runAction(action, phone, message, delayMinutes);
      console.log(`[tool] dispatch_action ${action}: ${result.detail}`);
      sessionRef.current?.sendToolResponse(id, name, {
        status: result.ok ? "ok" : "error",
        message: result.detail,
      });
      return;
    }
  }, [memories, persistMemories, runAction]);

  /* ---------- Reconnect (session 2-min limit) ---------- */
  const triggerReconnect = useCallback(() => {
    if (reconnectingRef.current) return;
    reconnectingRef.current = true;
    setStatus("reconnecting");
    setTimeout(async () => {
      await startSession();
      reconnectingRef.current = false;
    }, 200);
  }, [startSession]);

  /* ---------- TTS helper (used by direct chip actions) ---------- */
  const speakText = useCallback((text: string) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "es-ES";
    utter.rate = 0.95;
    window.speechSynthesis.speak(utter);
  }, []);

  /* ---------- Direct chip actions (bypass Live model — guaranteed execution) ----------
   *
   * The Live model is unreliable about deciding to fire function calls — it often
   * hallucinates a verbal confirmation ("listo, lo guardé") without actually invoking
   * the tool. To make every chip 100% demoable we execute the underlying tool directly
   * here and use the Web Speech API to narrate the outcome. The voice path (user
   * speaking to the model) still relies on Gemini's tool-calling behaviour.
   */

  const directVisual = useCallback(
    async (description: string, caption: string) => {
      setActionToast("Generando visual…");
      try {
        const res = await fetch("/api/visual", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ description }),
        });
        if (!res.ok) throw new Error(`visual ${res.status}`);
        const data = (await res.json()) as { mimeType: string; dataBase64: string };
        setVisual({ mimeType: data.mimeType, dataBase64: data.dataBase64, caption });
        speakText(caption);
      } catch (e) {
        console.error("[chip] visual failed:", e);
        speakText("No pude generar el visual");
      } finally {
        setActionToast(null);
      }
    },
    [speakText]
  );

  const directNearby = useCallback(
    async (query: string, sceneCues: string) => {
      setActionToast("Buscando lugar…");
      const coords = await new Promise<GeolocationPosition | null>((resolve) => {
        if (!navigator.geolocation) return resolve(null);
        navigator.geolocation.getCurrentPosition(
          (p) => resolve(p),
          () => resolve(null),
          { timeout: 4000 }
        );
      });
      try {
        const res = await fetch("/api/nearby", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query,
            sceneCues,
            lat: coords?.coords.latitude,
            lng: coords?.coords.longitude,
          }),
        });
        const data = (await res.json()) as { text?: string; error?: string };
        const message = data.text || data.error || "No encontré nada cercano";
        setActionToast(null);
        speakText(message);
      } catch (e) {
        console.error("[chip] nearby failed:", e);
        speakText("No pude buscar el lugar");
        setActionToast(null);
      }
    },
    [speakText]
  );

  const directSaveMemory = useCallback(
    async (label: string) => {
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
        const next = [newMem, ...memories].slice(0, MAX_MEMORIES);
        persistMemories(next);
        speakText(`Listo, guardé ${label} en tus memorias.`);
      } catch (e) {
        console.error("[chip] save_memory failed:", e);
        speakText("No pude guardar la memoria");
      } finally {
        setMemorySaving(null);
      }
    },
    [memories, persistMemories, speakText]
  );

  const handleChipTap = useCallback(
    (chipId: string) => {
      switch (chipId) {
        case "describe": {
          // Pure voice flow — Gemini just needs to describe the current frame
          const text = SUGGESTIONS.find((s) => s.id === "describe")?.text;
          if (text) sessionRef.current?.sendText(text);
          return;
        }
        case "draw":
          void directVisual(
            "Horario visual claro y bold para tomar pastillas cada 8 horas, agrupadas por desayuno, comida y cena, con iconos grandes de píldora y reloj. Estilo infografía editorial, paleta de alto contraste para baja visión, fondo oscuro, acentos amarillo. Texto en español.",
            "Te dibujo el horario de las pastillas"
          );
          return;
        case "find":
          void directNearby("farmacia más cercana", "sin pistas visuales claras");
          return;
        case "remember": {
          const time = new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          });
          void directSaveMemory(`Memoria · ${time}`);
          return;
        }
      }
    },
    [directVisual, directNearby, directSaveMemory]
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
          <ArrowLeft size={14} strokeWidth={2.25} className="text-white/85" />
          <span className="font-mono text-[10px] uppercase tracking-[0.32em] text-white/80">
            exit
          </span>
        </Link>

        <button
          onClick={() => setMemoriesOpen(true)}
          className="hairline-strong flex h-9 items-center gap-2 bg-black/50 px-3 backdrop-blur"
        >
          <Bookmark size={14} strokeWidth={2.25} className="text-[var(--signal)]" />
          <span className="font-mono text-[10px] uppercase tracking-[0.32em] text-white/80">
            memorias{memories.length > 0 ? ` · ${memories.length}` : ""}
          </span>
        </button>

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
              ? "Todo listo. Habla y AccessLens responde."
              : "Activa cámara y micrófono"}
          </h2>
          <p className="reveal reveal-3 mt-4 max-w-md text-center text-white/70">
            {status === "ready"
              ? "Pídele que describa, lea, dibuje, te lleve a un lugar, guarde una memoria o llame a alguien."
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
                <ChevronRight size={20} strokeWidth={2.5} />
              </button>
            )}
            {status === "ready" && (
              <button
                onClick={() => startSession()}
                className="flex h-14 items-center justify-between bg-[var(--signal)] px-5 text-[var(--signal-ink)]"
              >
                <span className="font-display text-lg font-bold">
                  Iniciar sesión Live
                </span>
                <Play size={18} strokeWidth={2.5} />
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
              onClick={() => startSession()}
              className="mt-5 flex h-12 w-full items-center justify-center gap-2 bg-[var(--signal)] font-bold text-[var(--signal-ink)]"
            >
              <RotateCcw size={16} strokeWidth={2.5} />
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
            className="mt-6 inline-flex items-center gap-2 bg-[var(--signal)] px-6 py-3 font-display font-bold text-[var(--signal-ink)]"
          >
            <X size={16} strokeWidth={2.5} />
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
            {muted ? (
              <MicOff size={14} strokeWidth={2.25} />
            ) : (
              <Mic size={14} strokeWidth={2.25} />
            )}
            <span className="font-mono text-[10px] uppercase tracking-[0.28em]">
              {muted ? "mic off" : "mic on"}
            </span>
          </button>
        </div>

        {/* Action chips — tap executes the underlying tool DIRECTLY (bypasses the
            Live model so the demo is reliable). The voice flow still relies on the
            model deciding to call its function declarations. */}
        <div className="grid grid-cols-4 gap-2">
          {SUGGESTIONS.map((s) => {
            const Icon = CHIP_ICONS[s.id] ?? Eye;
            return (
              <button
                key={s.id}
                disabled={!isLive}
                onClick={() => handleChipTap(s.id)}
                className="group relative flex flex-col items-center justify-center gap-1.5 border border-[var(--hairline-strong)] bg-black/55 px-2 py-3 text-center text-white backdrop-blur transition disabled:opacity-40 hover:border-[var(--signal)] active:bg-[var(--signal)] active:text-[var(--signal-ink)]"
              >
                <Icon size={22} strokeWidth={2} />
                <span className="font-display text-[11px] font-bold uppercase tracking-wider">
                  {s.label}
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
            <Square size={11} strokeWidth={2.5} fill="currentColor" className="text-[var(--warn)]" />
            <span className="font-mono text-[11px] uppercase tracking-[0.32em] text-white/85">
              detener sesión
            </span>
          </button>
        )}
      </footer>

      {/* Memory saving toast */}
      {memorySaving && (
        <div className="pointer-events-none absolute inset-x-0 top-24 z-30 flex justify-center px-6">
          <div className="hairline-strong flex items-center gap-3 bg-black/85 px-4 py-2 backdrop-blur">
            <span className="relative inline-block h-2 w-2 rounded-full bg-[var(--signal)] pulse-ring" />
            <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-white">
              guardando memoria · {memorySaving.label}
            </span>
          </div>
        </div>
      )}

      {/* Action dispatcher toast */}
      {actionToast && (
        <div className="pointer-events-none absolute inset-x-0 top-36 z-30 flex justify-center px-6">
          <div className="hairline-strong flex items-center gap-2 bg-[var(--signal)] px-4 py-2 text-[var(--signal-ink)]">
            <ArrowUpRight size={14} strokeWidth={2.5} />
            <span className="font-mono text-[11px] uppercase tracking-[0.28em] font-bold">
              {actionToast}
            </span>
          </div>
        </div>
      )}

      {/* Memorias overlay */}
      {memoriesOpen && (
        <div className="absolute inset-0 z-50 flex flex-col bg-black">
          <header className="flex items-center justify-between border-b border-[var(--hairline-strong)] px-5 py-5">
            <button
              onClick={() => {
                setMemoriesOpen(false);
                setActiveMemory(null);
                if (typeof window !== "undefined") window.speechSynthesis?.cancel();
              }}
              className="hairline-strong flex h-9 items-center gap-2 px-3"
            >
              <ArrowLeft size={14} strokeWidth={2.25} />
              <span className="font-mono text-[10px] uppercase tracking-[0.32em]">
                volver
              </span>
            </button>
            <div className="text-center">
              <span className="font-mono text-[10px] uppercase tracking-[0.32em] text-white/60">
                galería
              </span>
              <h2 className="font-display text-xl font-black uppercase tracking-tight">
                Mis memorias
              </h2>
            </div>
            <span className="font-mono text-[10px] uppercase tracking-[0.32em] text-white/60">
              {memories.length} / {MAX_MEMORIES}
            </span>
          </header>

          <div className="flex-1 overflow-y-auto px-4 py-5">
            {memories.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center px-8 text-center text-white/55">
                <Save size={56} strokeWidth={1.5} className="text-white/30" />
                <p className="mt-5 max-w-xs font-display text-lg leading-tight">
                  Aún no tienes memorias. Apunta la cámara a algo importante y toca
                  el botón Recuerda o di &quot;guarda esto&quot;.
                </p>
              </div>
            )}

            {memories.length > 0 && !activeMemory && (
              <div className="grid grid-cols-2 gap-3">
                {memories.map((m) => {
                  const date = new Date(m.timestamp);
                  return (
                    <button
                      key={m.id}
                      onClick={() => {
                        setActiveMemory(m);
                        speakMemory(m);
                      }}
                      className="group relative flex flex-col overflow-hidden border border-[var(--hairline-strong)] bg-black text-left transition hover:border-[var(--signal)]"
                    >
                      <div className="aspect-square w-full overflow-hidden bg-black">
                        <img
                          src={`data:${m.mimeType};base64,${m.imageBase64}`}
                          alt={m.label}
                          className="block h-full w-full object-cover"
                        />
                      </div>
                      <div className="px-3 py-2">
                        <p className="font-display text-[13px] font-bold leading-tight line-clamp-2">
                          {m.label}
                        </p>
                        <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.22em] text-white/50">
                          {date.toLocaleDateString()} · {date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {activeMemory && (
              <div className="mx-auto max-w-md">
                <button
                  onClick={() => {
                    setActiveMemory(null);
                    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
                  }}
                  className="mb-4 inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.32em] text-white/70"
                >
                  <ArrowLeft size={12} strokeWidth={2.25} />
                  todas las memorias
                </button>
                <div className="hairline-strong overflow-hidden bg-black">
                  <img
                    src={`data:${activeMemory.mimeType};base64,${activeMemory.imageBase64}`}
                    alt={activeMemory.label}
                    className="block w-full"
                  />
                </div>
                <h3 className="mt-5 font-display text-2xl font-black leading-tight">
                  {activeMemory.label}
                </h3>
                <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.28em] text-white/60">
                  {new Date(activeMemory.timestamp).toLocaleString()}
                </p>
                <p className="mt-4 text-base leading-relaxed text-white/90">
                  {activeMemory.description}
                </p>
                <div className="mt-6 flex gap-3">
                  <button
                    onClick={() => speakMemory(activeMemory)}
                    className="flex h-12 flex-1 items-center justify-center gap-2 bg-[var(--signal)] font-display font-bold text-[var(--signal-ink)]"
                  >
                    <Play size={16} strokeWidth={2.5} fill="currentColor" />
                    Reescuchar
                  </button>
                  <button
                    onClick={() => deleteMemory(activeMemory.id)}
                    className="hairline-strong flex h-12 w-12 items-center justify-center text-[var(--warn)]"
                    aria-label="Eliminar memoria"
                  >
                    <X size={16} strokeWidth={2.5} />
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

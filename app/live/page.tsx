"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  IconArrowLeft,
  IconBook,
  IconBookmark,
  IconBookmarkPlus,
  IconCameraRotate,
  IconCircleCheck,
  IconEye,
  IconMapPin,
  IconMicrophone,
  IconMicrophoneOff,
  IconPalette,
  IconPlayerPlayFilled,
  IconPlayerStopFilled,
  IconRefresh,
  IconSettings,
  IconSparkles,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import {
  AudioCapture,
  AudioPlayer,
  captureFrameJpegBase64,
  int16ToBase64,
} from "@/lib/audio";
import { LiveSession, fetchEphemeralToken } from "@/lib/gemini-live";
import { ASSISTANT } from "@/lib/modes";
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

interface Memory {
  id: string;
  label: string;
  description: string;
  imageBase64: string;
  mimeType: string;
  timestamp: number;
}

type ModeId = "ojos" | "leer" | "visual" | "donde";

interface ModeChip {
  id: ModeId;
  label: string;
  Icon: React.ComponentType<{ size?: number; stroke?: number }>;
  directive: string; // sent to Live model on mode select
}

const MODE_CHIPS: ModeChip[] = [
  {
    id: "ojos",
    label: "Ojos",
    Icon: IconEye,
    directive:
      "Modo OJOS activo. Describe brevemente y con detalle lo que ves por la cámara ahora mismo. Frase corta, voz cálida.",
  },
  {
    id: "leer",
    label: "Leer",
    Icon: IconBook,
    directive:
      "Modo LEER activo. Lee LITERALMENTE en voz alta el texto que veas en cámara. Si está en otro idioma, tradúcelo al español. Frases cortas.",
  },
  {
    id: "visual",
    label: "Visual",
    Icon: IconPalette,
    directive:
      "Modo VISUAL activo. Pregúntame en una sola frase corta y amable QUÉ quiero que dibujes. Cuando responda, llama generate_visual_aid INMEDIATAMENTE con descripción detallada en alto contraste.",
  },
  {
    id: "donde",
    label: "Dónde",
    Icon: IconMapPin,
    directive:
      "Modo DÓNDE activo. Pregúntame en una sola frase corta A DÓNDE quiero ir. Cuando responda, llama find_nearby_place INMEDIATAMENTE con mi consulta.",
  },
];

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
  const [activeMode, setActiveMode] = useState<ModeId | null>(null);
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");

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
        // Replace previous stream if any
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
      // Stop video tracks but keep audio (user already authorized mic)
      const stream = streamRef.current;
      stream?.getVideoTracks().forEach((t) => t.stop());
      try {
        const newStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: next }, width: { ideal: 1280 } },
        });
        const newVideoTrack = newStream.getVideoTracks()[0];
        if (stream && newVideoTrack) {
          // Replace the video track in the existing stream
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

  /* ---------- TTS helper ---------- */
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

  /* ---------- Direct save current frame as memory ---------- */
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
      speakText(`Listo, guardé ${label} en tus memorias.`);
    } catch (e) {
      console.error("[memory] save failed:", e);
      speakText("No pude guardar la memoria");
    } finally {
      setMemorySaving(null);
    }
  }, [memories, persistMemories, speakText]);

  /* ---------- Action toast auto-dismiss ---------- */
  useEffect(() => {
    if (!actionToast) return;
    const t = window.setTimeout(() => setActionToast(null), 3000);
    return () => window.clearTimeout(t);
  }, [actionToast]);

  /* ---------- runAction (used by dispatch_action tool) ---------- */
  const runAction = useCallback(
    (action: string, phone: string, message: string, delayMinutes: number) => {
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
        return { ok: true, detail: "SMS abierto" };
      }
      if (action === "alarm" && delayMinutes > 0) {
        const ms = delayMinutes * 60 * 1000;
        const fire = () => {
          if ("Notification" in window && Notification.permission === "granted") {
            new Notification("AccessLens — recordatorio", { body: message || "Es hora" });
          } else {
            alert(`AccessLens recordatorio: ${message || "Es hora"}`);
          }
        };
        if ("Notification" in window && Notification.permission !== "granted") {
          Notification.requestPermission().then(() => window.setTimeout(fire, ms));
        } else {
          window.setTimeout(fire, ms);
        }
        setActionToast(`Alarma en ${delayMinutes} min`);
        return { ok: true, detail: `Alarma en ${delayMinutes} min` };
      }
      if (action === "share" && navigator.share) {
        navigator
          .share({ title: "AccessLens", text: message || "Compartido desde AccessLens" })
          .catch(() => undefined);
        setActionToast("Compartiendo…");
        return { ok: true, detail: "Diálogo abierto" };
      }
      return { ok: false, detail: "Acción no soportada" };
    },
    []
  );

  /* ---------- Tool calls (when Gemini fires functions) ---------- */
  const handleToolCall = useCallback(
    async (call: FunctionCall) => {
      const id = call.id ?? "";
      const name = call.name ?? "";
      const args = (call.args ?? {}) as Record<string, unknown>;
      console.log(`%c[tool] ${name}`, "color:#60a5fa;font-weight:bold", args);

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
            const body = await res.text();
            try {
              const parsed = JSON.parse(body) as { error?: string; needsBilling?: boolean };
              if (parsed.needsBilling) {
                speakText(
                  "Para dibujar imágenes necesitas activar facturación en tu API key de Google."
                );
                sessionRef.current?.sendToolResponse(id, name, {
                  status: "error",
                  message: "API key sin billing",
                });
                return;
              }
              throw new Error(parsed.error ?? `visual ${res.status}`);
            } catch {
              throw new Error(`visual ${res.status}`);
            }
          }
          const data = (await res.json()) as { mimeType: string; dataBase64: string };
          setVisual({ mimeType: data.mimeType, dataBase64: data.dataBase64, caption });
          sessionRef.current?.sendToolResponse(id, name, {
            status: "ok",
            message: "Imagen mostrada en pantalla.",
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

      if (name === "dispatch_action") {
        const action = String(args.action ?? "").toLowerCase();
        const phone = String(args.phone ?? "");
        const message = String(args.message ?? "");
        const delayMinutes = Number(args.delayMinutes ?? 0);
        const result = runAction(action, phone, message, delayMinutes);
        sessionRef.current?.sendToolResponse(id, name, {
          status: result.ok ? "ok" : "error",
          message: result.detail,
        });
        return;
      }
    },
    [memories, persistMemories, runAction, speakText]
  );

  /* ---------- Connect Session ---------- */
  const startSession = useCallback(
    async () => {
      setError(null);
      setStatus("connecting");
      setUserCaption("");
      setAiCaption("");
      userBufferRef.current = "";
      aiBufferRef.current = "";

      sessionRef.current?.close();
      captureRef.current?.stop();
      playerRef.current?.close();
      if (frameTimerRef.current) window.clearInterval(frameTimerRef.current);
      if (sessionTimerRef.current) window.clearInterval(sessionTimerRef.current);

      // iOS Safari: create + resume AudioPlayer synchronously inside the user gesture
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
          },
          {
            onOpen: () => {
              setStatus("live");
              setElapsed(0);
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
          setElapsed((prev) => {
            const next = prev + 1;
            if (next >= SESSION_LIMIT_SEC) triggerReconnect();
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

  const triggerReconnect = useCallback(() => {
    if (reconnectingRef.current) return;
    reconnectingRef.current = true;
    setStatus("reconnecting");
    setTimeout(async () => {
      await startSession();
      reconnectingRef.current = false;
    }, 200);
  }, [startSession]);

  /* ---------- Mode select ---------- */
  const selectMode = useCallback((id: ModeId) => {
    setActiveMode(id);
    const chip = MODE_CHIPS.find((c) => c.id === id);
    if (chip && sessionRef.current) {
      sessionRef.current.sendText(chip.directive);
    }
  }, []);

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

  /* ---------- Voice wave bars (12 bars with audioLevel modulation) ---------- */
  const renderVoiceBars = () => {
    const base = Math.min(1, audioLevel * 5);
    return (
      <div className="flex items-end gap-[3px] h-9">
        {Array.from({ length: 12 }).map((_, i) => {
          const phase = (i + 1) / 12;
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
      {/* === Camera background gradient (always behind) === */}
      <div aria-hidden className="camera-bg absolute inset-0" />

      {/* === Camera === */}
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="absolute inset-0 h-full w-full object-cover"
        style={{ opacity: status === "ready" || isLive ? 0.92 : 0 }}
      />
      <div aria-hidden className="grain pointer-events-none absolute inset-0" />

      {/* === Top scrim === */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 z-10 h-32"
        style={{ background: "var(--scrim-top)" }}
      />

      {/* === Corner guides === */}
      <span className="corner-guide tl" />
      <span className="corner-guide tr" />
      <span className="corner-guide bl" />
      <span className="corner-guide br" />

      {/* === Center focus circle (fade out when caption is showing or visual is up) === */}
      {isLive && !aiCaption && !userCaption && !visual && (
        <span className="focus-circle" />
      )}

      {/* === Top nav === */}
      <header className="absolute inset-x-0 top-0 z-20 flex items-start justify-between px-4 pt-5">
        <div className="flex items-center gap-2.5">
          <Link
            href="/"
            className="grid h-8 w-8 place-items-center rounded-[10px] bg-white/8 backdrop-blur ring-1 ring-inset ring-white/15"
            aria-label="Volver"
          >
            <IconArrowLeft size={16} stroke={2.25} />
          </Link>
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className="grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-[var(--blue-400)] to-[var(--blue-700)] text-white"
            >
              <IconSparkles size={14} stroke={2.25} />
            </span>
            <span className="font-display text-[14px] font-semibold tracking-tight">
              AccessLens
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-black/40 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.28em] text-white/85 backdrop-blur ring-1 ring-inset ring-white/15">
            <span className="live-dot" /> en vivo
          </span>
          <button
            onClick={() => setMemoriesOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-full bg-black/40 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.28em] text-white/85 backdrop-blur ring-1 ring-inset ring-white/15"
          >
            <IconBookmark size={12} stroke={2} />
            {memories.length > 0 ? memories.length : ""}
          </button>
        </div>
      </header>

      {/* === Active mode badge (top center) === */}
      {isLive && activeMode && (
        <div className="pointer-events-none absolute inset-x-0 top-20 z-15 flex justify-center">
          <div className="reveal flex items-center gap-2 rounded-full bg-white/15 px-3 py-1.5 backdrop-blur ring-1 ring-inset ring-white/25">
            {(() => {
              const chip = MODE_CHIPS.find((c) => c.id === activeMode)!;
              const I = chip.Icon;
              return (
                <>
                  <I size={12} stroke={2.25} />
                  <span className="font-display text-[11px] font-bold uppercase tracking-[0.2em]">
                    {chip.label} activo
                  </span>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* === Voice wave bars (mid-screen, fades in when active) === */}
      {isLive && (
        <div className="pointer-events-none absolute inset-x-0 top-[36%] z-15 flex justify-center">
          {renderVoiceBars()}
        </div>
      )}

      {/* === Caption box near bottom of camera area === */}
      {(userCaption || aiCaption) && (
        <div className="pointer-events-none absolute inset-x-0 bottom-[260px] z-15 flex flex-col items-center gap-2 px-6">
          {userCaption && (
            <div className="caption-box caption-line max-w-[28ch] rounded-lg px-3 py-2 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-white/80">
              {userCaption.trim()}
            </div>
          )}
          {aiCaption && (
            <div
              key={aiCaption.length}
              className="caption-box caption-line max-w-[34ch] rounded-lg px-4 py-2.5 text-center text-[13px] font-medium leading-snug text-white"
            >
              {aiCaption.trim()}
              <span className="caret" />
            </div>
          )}
        </div>
      )}

      {/* === Session timer (subtle, top-right area) === */}
      {isLive && (
        <div className="pointer-events-none absolute right-4 top-[60px] z-15">
          <span
            className={`font-mono text-[10px] tabular-nums ${
              elapsed > SESSION_LIMIT_SEC - 15 ? "text-[var(--warn)]" : "text-white/55"
            }`}
          >
            {formatTime(Math.min(elapsed, SESSION_LIMIT_SEC))}
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
          <h2 className="reveal reveal-2 max-w-md text-center font-display text-[34px] font-black leading-[0.95] tracking-tight">
            {status === "ready"
              ? "Todo listo. Habla y AccessLens responde."
              : "Activa cámara y micrófono"}
          </h2>
          <p className="reveal reveal-3 mt-3 max-w-md text-center text-[14px] leading-snug text-white/65">
            {status === "ready"
              ? "Pídele que describa, lea, dibuje, te lleve a un lugar o guarde memorias."
              : "AccessLens necesita ver y oír para asistirte. Tus datos no se guardan."}
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
                <span className="font-display text-[17px] font-bold">Iniciar sesión Live</span>
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

      {/* === Visual overlay === */}
      {visual && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-[var(--bg)]/95 px-4">
          <div className="card relative w-full max-w-md overflow-hidden">
            <img
              src={`data:${visual.mimeType};base64,${visual.dataBase64}`}
              alt="Visual generado"
              className="block h-auto w-full"
            />
          </div>
          <p className="mt-4 max-w-md text-center font-display text-[15px] text-white/85">
            {visual.caption}
          </p>
          <button
            onClick={() => setVisual(null)}
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[var(--blue-600)] px-6 py-3 font-display font-bold text-white"
          >
            <IconX size={16} stroke={2.5} />
            Cerrar
          </button>
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

      {/* === Action toast === */}
      {actionToast && (
        <div className="pointer-events-none absolute inset-x-0 top-44 z-30 flex justify-center px-6">
          <div className="flex items-center gap-2 rounded-full bg-[var(--blue-600)] px-4 py-2 text-white">
            <IconCircleCheck size={14} stroke={2.25} />
            <span className="font-mono text-[10px] uppercase tracking-[0.28em] font-bold">
              {actionToast}
            </span>
          </div>
        </div>
      )}

      {/* === BOTTOM PANEL === */}
      <footer
        className="absolute inset-x-0 bottom-0 z-20 px-3 pb-4 pt-3"
        style={{ background: "var(--bg-overlay)", backdropFilter: "blur(12px)" }}
      >
        <div className="mx-auto max-w-[420px]">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-[9px] uppercase tracking-[0.32em] text-white/45">
              modo
            </span>
            {isLive && (
              <button
                onClick={() => stopAll()}
                className="inline-flex items-center gap-1.5 rounded-md bg-white/5 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.28em] text-white/55 ring-1 ring-inset ring-white/10"
              >
                <IconPlayerStopFilled size={9} className="text-[var(--warn)]" />
                detener
              </button>
            )}
          </div>

          {/* === 4 mode chips === */}
          <div className="grid grid-cols-4 gap-2">
            {MODE_CHIPS.map((chip) => {
              const Icon = chip.Icon;
              const isActive = activeMode === chip.id;
              return (
                <button
                  key={chip.id}
                  disabled={!isLive}
                  onClick={() => selectMode(chip.id)}
                  className={`group relative flex flex-col items-center justify-center gap-1.5 rounded-xl py-3 text-center transition disabled:opacity-30 ${
                    isActive
                      ? "bg-white/12 text-white ring-1 ring-inset ring-white/55"
                      : "bg-white/5 text-white/85 ring-1 ring-inset ring-white/10 active:bg-white/10"
                  }`}
                >
                  <Icon size={20} stroke={1.85} />
                  <span className="font-display text-[11px] font-bold tracking-wide">
                    {chip.label}
                  </span>
                </button>
              );
            })}
          </div>

          {/* === Mic + side actions === */}
          <div className="mt-3 flex items-center justify-between gap-3 px-2">
            <button
              disabled={!isLive}
              onClick={() => setSettingsOpen(true)}
              className="grid h-11 w-11 place-items-center rounded-full bg-white/5 text-white/75 ring-1 ring-inset ring-white/10 transition disabled:opacity-30 active:bg-white/10"
              aria-label="Ajustes"
            >
              <IconSettings size={18} stroke={1.85} />
            </button>

            <button
              disabled={!isLive}
              onClick={() => setMuted((m) => !m)}
              className={`relative grid h-[68px] w-[68px] place-items-center rounded-full transition disabled:opacity-30 active:scale-[0.97] ${
                muted ? "bg-[var(--warn)] text-white" : "bg-white text-[var(--bg)]"
              }`}
              aria-label={muted ? "Activar mic" : "Silenciar mic"}
            >
              {!muted && <span className="halo" aria-hidden />}
              {muted ? (
                <IconMicrophoneOff size={26} stroke={2} />
              ) : (
                <IconMicrophone size={26} stroke={2} />
              )}
            </button>

            <button
              disabled={!isLive}
              onClick={flipCamera}
              className="grid h-11 w-11 place-items-center rounded-full bg-white/5 text-white/75 ring-1 ring-inset ring-white/10 transition disabled:opacity-30 active:bg-white/10"
              aria-label="Cambiar cámara"
            >
              <IconCameraRotate size={18} stroke={1.85} />
            </button>
          </div>
        </div>
      </footer>

      {/* === Settings sheet === */}
      {settingsOpen && (
        <div
          className="absolute inset-0 z-50 flex items-end bg-black/55 backdrop-blur-sm"
          onClick={() => setSettingsOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full rounded-t-3xl bg-[var(--bg-card)] p-5 ring-1 ring-inset ring-[var(--hairline-strong)]"
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/15" />
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
                  void saveCurrentMoment();
                }}
                className="flex w-full items-center gap-2.5 rounded-xl bg-white/5 px-4 py-3 ring-1 ring-inset ring-[var(--hairline)]"
              >
                <IconBookmarkPlus size={16} stroke={1.85} className="text-[var(--blue-300)]" />
                <span className="font-display text-[14px] font-semibold">
                  Guardar este momento
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
          <header className="flex items-center justify-between border-b border-[var(--hairline)] px-4 py-4">
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
              <h2 className="font-display text-[16px] font-black tracking-tight">
                Mis memorias
              </h2>
            </div>
            <span className="font-mono text-[10px] tabular-nums text-white/55">
              {memories.length}/{MAX_MEMORIES}
            </span>
          </header>

          <div className="flex-1 overflow-y-auto px-4 py-4">
            {!activeMemory && isLive && (
              <button
                onClick={() => void saveCurrentMoment()}
                className="mb-4 flex w-full items-center gap-3 rounded-2xl bg-[var(--blue-600)] px-4 py-3.5 text-white shadow-[0_8px_24px_-8px_rgba(37,99,235,0.55)] transition active:scale-[0.99]"
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
                  Aún no tienes memorias. Toca <span className="text-[var(--blue-300)]">Guardar este momento</span> para empezar.
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
              <div className="mx-auto max-w-md">
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
                <h3 className="mt-5 font-display text-[22px] font-black leading-tight">
                  {activeMemory.label}
                </h3>
                <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.28em] text-white/55">
                  {new Date(activeMemory.timestamp).toLocaleString()}
                </p>
                <p className="mt-4 text-[14px] leading-relaxed text-white/85">
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

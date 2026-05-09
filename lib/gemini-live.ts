import {
  GoogleGenAI,
  Modality,
  StartSensitivity,
  EndSensitivity,
  type Session,
  type LiveServerMessage,
  type FunctionDeclaration,
  type FunctionCall,
} from "@google/genai";

export interface LiveSessionEvents {
  onAudio?: (base64: string) => void;
  onInputTranscription?: (text: string) => void;
  onOutputTranscription?: (text: string) => void;
  onTurnComplete?: () => void;
  onInterrupted?: () => void;
  onToolCall?: (call: FunctionCall) => void;
  onClose?: (reason: string) => void;
  onError?: (err: Error) => void;
  onOpen?: () => void;
  /** Fired when the server sends a new session-resumption handle. Persist
   *  this in the parent so that on reconnect you can pass it back via
   *  `LiveSessionInit.resumeHandle` and continue the conversation without
   *  losing context. */
  onResumeHandleUpdate?: (handle: string) => void;
  /** Fired when the server announces it will disconnect soon. Use this to
   *  preemptively spin up a new session BEFORE the current one closes so
   *  the audio stream is uninterrupted. */
  onGoAway?: (timeLeftSec: number) => void;
}

export interface LiveSessionInit {
  token: string;
  model: string;
  systemInstruction: string;
  tools?: FunctionDeclaration[];
  /** Spoken on first session ONLY. When `resumeHandle` is set we suppress
   *  the kickoff so the resumed session continues seamlessly. */
  kickoff?: string;
  /** Handle returned by a previous session via `onResumeHandleUpdate`.
   *  When present the new session restores the prior conversation. */
  resumeHandle?: string;
}

export class LiveSession {
  private ai: GoogleGenAI;
  private session?: Session;
  private events: LiveSessionEvents;
  private readonly init: LiveSessionInit;
  private closed = false;
  private setupReady = false;
  private pendingAudio: string[] = [];
  private pendingFrame: string | null = null;
  // AI-speaking gate: while we're playing back model audio we DROP the user's mic
  // upload. Echo cancellation isn't perfect (it takes ~300ms to converge at the
  // start of each turn and can leak briefly mid-turn), and any speaker bleed
  // reaching the server VAD would trigger a barge-in interrupt that cuts the
  // model mid-sentence. Trade-off: real barge-in is disabled — user must tap
  // the on-screen mic toggle if they want to interrupt.
  private aiSpeaking = false;
  private aiSpeakingDrainTimer?: ReturnType<typeof setTimeout>;
  /** Latest resumable handle issued by the server. Read by the parent
   *  before triggering a reconnect so the next session continues the
   *  conversation. */
  private resumeHandle?: string;

  constructor(init: LiveSessionInit, events: LiveSessionEvents) {
    this.init = init;
    this.events = events;
    this.ai = new GoogleGenAI({
      apiKey: init.token,
      httpOptions: { apiVersion: "v1alpha" },
    });
  }

  async connect() {
    console.log("[live] connect attempt", {
      model: this.init.model,
      hasTools: (this.init.tools?.length ?? 0) > 0,
    });
    this.session = await this.ai.live.connect({
      model: this.init.model,
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: this.init.systemInstruction,
        tools:
          this.init.tools && this.init.tools.length > 0
            ? [{ functionDeclarations: this.init.tools }]
            : undefined,
        // Tame the server-side VAD so brief speaker bleed (echo from the device's
        // own playback) doesn't trigger a barge-in interrupt. The user has to talk
        // for ~1s of clean speech before we treat it as an interruption.
        realtimeInputConfig: {
          automaticActivityDetection: {
            startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_LOW,
            endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_LOW,
            prefixPaddingMs: 1000,
            silenceDurationMs: 1500,
          },
        },
        // Session resumption: server periodically issues a `newHandle` we can use
        // to reconnect later and continue the conversation without losing
        // context. Pass the previous handle in `init.resumeHandle` to restore.
        sessionResumption: this.init.resumeHandle
          ? { handle: this.init.resumeHandle, transparent: true }
          : { transparent: true },
      },
      callbacks: {
        onopen: () => {
          console.log("[live] WS open");
          this.events.onOpen?.();
        },
        onmessage: (msg) => {
          if (msg.setupComplete) {
            this.setupReady = true;
            console.log("[live] setupComplete — gate open, flushing pending media");
            this.flushPending();
            // Send kickoff ONLY on a fresh session. When resuming, the server
            // already has the prior turn history and re-greeting would feel
            // jarring to the user mid-conversation.
            if (this.init.kickoff && !this.init.resumeHandle) {
              console.log("[live] sending kickoff text to wake the model");
              this.session?.sendClientContent({
                turns: [
                  { role: "user", parts: [{ text: this.init.kickoff }] },
                ],
                turnComplete: true,
              });
            } else if (this.init.resumeHandle) {
              console.log("[live] resumed session — kickoff suppressed");
            }
          }
          if (msg.sessionResumptionUpdate?.resumable && msg.sessionResumptionUpdate.newHandle) {
            this.resumeHandle = msg.sessionResumptionUpdate.newHandle;
            this.events.onResumeHandleUpdate?.(this.resumeHandle);
          }
          if (msg.goAway) {
            const raw = msg.goAway.timeLeft ?? "0s";
            // Duration string like "30s" or "12.500s" — parse to seconds
            const m = /^([\d.]+)s$/.exec(String(raw));
            const seconds = m ? Math.max(0, Math.floor(parseFloat(m[1]))) : 0;
            console.warn(`[live] goAway in ~${seconds}s — preempting reconnect`);
            this.events.onGoAway?.(seconds);
          }
          this.handleMessage(msg);
        },
        onerror: (e) => {
          const errStr =
            e instanceof Error ? `${e.name}: ${e.message}` : JSON.stringify(e);
          console.error("[live] WS error -> " + errStr);
          const err = e instanceof Error ? e : new Error(String(e));
          this.events.onError?.(err);
        },
        onclose: (e) => {
          const evt = e as unknown as {
            code?: number;
            reason?: string;
            wasClean?: boolean;
          };
          console.warn(
            `[live] WS close >> code=${evt.code ?? "?"} wasClean=${evt.wasClean ?? "?"} reason="${evt.reason ?? ""}"`
          );
          this.closed = true;
          this.events.onClose?.(evt.reason ?? "closed");
        },
      },
    });
    console.log("[live] connect resolved");
  }

  private firstAudioLogged = false;

  private handleMessage(msg: LiveServerMessage) {
    const sc = msg.serverContent;
    if (sc) {
      if (sc.interrupted) {
        console.warn("[live] server fired INTERRUPTED — model output cut. Likely VAD thinks user is talking (check echo cancellation / speaker bleed).");
        this.events.onInterrupted?.();
      }

      const inputText = sc.inputTranscription?.text;
      if (inputText) this.events.onInputTranscription?.(inputText);

      const outputText = sc.outputTranscription?.text;
      if (outputText) this.events.onOutputTranscription?.(outputText);

      const parts = sc.modelTurn?.parts ?? [];
      for (const part of parts) {
        const inline = part.inlineData;
        if (inline?.data && inline.mimeType?.startsWith("audio/")) {
          if (!this.firstAudioLogged) {
            this.firstAudioLogged = true;
            console.log("[live] first audio chunk received");
          }
          // Gate ON: AI is speaking, drop any inbound mic chunks until the gate
          // releases so the speaker bleed never reaches the server VAD.
          this.aiSpeaking = true;
          if (this.aiSpeakingDrainTimer) {
            clearTimeout(this.aiSpeakingDrainTimer);
            this.aiSpeakingDrainTimer = undefined;
          }
          this.events.onAudio?.(inline.data);
        }
      }

      if (sc.turnComplete) {
        // Drain timer: keep the gate closed for a moment after turnComplete so
        // the AudioPlayer buffer finishes flushing before we re-open the mic.
        if (this.aiSpeakingDrainTimer) clearTimeout(this.aiSpeakingDrainTimer);
        this.aiSpeakingDrainTimer = setTimeout(() => {
          this.aiSpeaking = false;
          this.aiSpeakingDrainTimer = undefined;
          console.log("[live] mic gate re-opened after turn drain");
        }, 600);
        this.events.onTurnComplete?.();
      }
    }

    if (msg.toolCall?.functionCalls) {
      for (const call of msg.toolCall.functionCalls) {
        console.log("[live] toolCall", call.name);
        this.events.onToolCall?.(call);
      }
    }
  }

  private flushPending() {
    if (!this.session || this.closed || !this.setupReady) return;
    const audio = this.pendingAudio;
    this.pendingAudio = [];
    for (const data of audio) {
      this.session.sendRealtimeInput({
        audio: { data, mimeType: "audio/pcm;rate=16000" },
      });
    }
    if (this.pendingFrame) {
      this.session.sendRealtimeInput({
        video: { data: this.pendingFrame, mimeType: "image/jpeg" },
      });
      this.pendingFrame = null;
    }
  }

  private audioSendCount = 0;
  private rmsAccum = 0;
  private rmsCount = 0;

  sendAudio(base64: string, rms = 0) {
    if (!this.session || this.closed) return;
    if (!this.setupReady) {
      if (this.pendingAudio.length < 16) this.pendingAudio.push(base64);
      return;
    }
    // Drop the chunk while the AI is speaking so we never feed echo back to
    // the server's VAD. Buffered chunks captured during model speech are
    // discarded — there's no point sending stale audio after the gate opens.
    if (this.aiSpeaking) return;
    this.session.sendRealtimeInput({
      audio: { data: base64, mimeType: "audio/pcm;rate=16000" },
    });
    this.audioSendCount++;
    this.rmsAccum += rms;
    this.rmsCount++;
    if (this.audioSendCount === 1 || this.audioSendCount % 20 === 0) {
      const avgRms = this.rmsCount > 0 ? this.rmsAccum / this.rmsCount : 0;
      console.log(
        `[live] audio sent: ${this.audioSendCount} chunks, avg RMS last 20=${avgRms.toFixed(4)}`
      );
      this.rmsAccum = 0;
      this.rmsCount = 0;
    }
  }

  sendVideoFrame(jpegBase64: string) {
    if (!this.session || this.closed) return;
    if (!this.setupReady) {
      this.pendingFrame = jpegBase64;
      return;
    }
    this.session.sendRealtimeInput({
      video: { data: jpegBase64, mimeType: "image/jpeg" },
    });
  }

  sendText(text: string) {
    if (!this.session || this.closed) return;
    this.session.sendClientContent({
      turns: [{ role: "user", parts: [{ text }] }],
      turnComplete: true,
    });
  }

  sendToolResponse(id: string, name: string, response: Record<string, unknown>) {
    if (!this.session || this.closed) return;
    this.session.sendToolResponse({
      functionResponses: [{ id, name, response }],
    });
  }

  close() {
    this.closed = true;
    try {
      this.session?.close();
    } catch {
      /* noop */
    }
  }

  isClosed() {
    return this.closed;
  }

  /** Latest resumable handle issued by the server. Pass this to a new
   *  LiveSession via `init.resumeHandle` to continue the conversation
   *  without losing context. Returns undefined if the server has not yet
   *  issued a handle (early in the session) or if the most recent state
   *  was non-resumable (mid tool-call). */
  getResumeHandle(): string | undefined {
    return this.resumeHandle;
  }
}

export async function fetchEphemeralToken(): Promise<{ token: string; model: string }> {
  const res = await fetch("/api/token", { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `token endpoint returned ${res.status}`);
  }
  const data = (await res.json()) as { token: string; model: string };
  if (!data.token) throw new Error("token endpoint returned empty token");
  return data;
}

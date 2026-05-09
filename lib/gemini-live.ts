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
}

export interface LiveSessionInit {
  token: string;
  model: string;
  systemInstruction: string;
  tools?: FunctionDeclaration[];
}

export class LiveSession {
  private ai: GoogleGenAI;
  private session?: Session;
  private events: LiveSessionEvents;
  private readonly init: LiveSessionInit;
  private closed = false;

  constructor(init: LiveSessionInit, events: LiveSessionEvents) {
    this.init = init;
    this.events = events;
    this.ai = new GoogleGenAI({
      apiKey: init.token,
      apiVersion: "v1alpha",
    });
  }

  async connect() {
    this.session = await this.ai.live.connect({
      model: this.init.model,
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: this.init.systemInstruction,
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        enableAffectiveDialog: true,
        proactivity: { proactiveAudio: false },
        realtimeInputConfig: {
          automaticActivityDetection: {
            startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_LOW,
            endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_LOW,
            prefixPaddingMs: 50,
            silenceDurationMs: 800,
          },
        },
        tools: this.init.tools && this.init.tools.length > 0
          ? [{ functionDeclarations: this.init.tools }]
          : undefined,
      },
      callbacks: {
        onopen: () => this.events.onOpen?.(),
        onmessage: (msg) => this.handleMessage(msg),
        onerror: (e) => {
          const err = e instanceof Error ? e : new Error(String(e));
          this.events.onError?.(err);
        },
        onclose: (e) => {
          this.closed = true;
          this.events.onClose?.(e.reason ?? "closed");
        },
      },
    });
  }

  private handleMessage(msg: LiveServerMessage) {
    const sc = msg.serverContent;
    if (sc) {
      if (sc.interrupted) this.events.onInterrupted?.();

      const inputText = sc.inputTranscription?.text;
      if (inputText) this.events.onInputTranscription?.(inputText);

      const outputText = sc.outputTranscription?.text;
      if (outputText) this.events.onOutputTranscription?.(outputText);

      const parts = sc.modelTurn?.parts ?? [];
      for (const part of parts) {
        const inline = part.inlineData;
        if (inline?.data && inline.mimeType?.startsWith("audio/")) {
          this.events.onAudio?.(inline.data);
        }
      }

      if (sc.turnComplete) this.events.onTurnComplete?.();
    }

    if (msg.toolCall?.functionCalls) {
      for (const call of msg.toolCall.functionCalls) {
        this.events.onToolCall?.(call);
      }
    }
  }

  sendAudio(base64: string) {
    if (!this.session || this.closed) return;
    this.session.sendRealtimeInput({
      audio: { data: base64, mimeType: "audio/pcm;rate=16000" },
    });
  }

  sendVideoFrame(jpegBase64: string) {
    if (!this.session || this.closed) return;
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

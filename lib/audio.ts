export const INPUT_SAMPLE_RATE = 16000;
export const OUTPUT_SAMPLE_RATE = 24000;
const CAPTURE_BUFFER_SIZE = 4096;

// Inline AudioWorklet processor — accumulates native-rate frames into 4096-sample chunks
// and posts them to the main thread. iOS 16+ Safari does NOT reliably fire ScriptProcessorNode's
// onaudioprocess callback, so AudioWorklet is mandatory on iPhone.
const CAPTURE_WORKLET_CODE = `
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(${CAPTURE_BUFFER_SIZE});
    this.idx = 0;
  }
  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const ch = input[0];
    for (let i = 0; i < ch.length; i++) {
      this.buffer[this.idx++] = ch[i];
      if (this.idx >= this.buffer.length) {
        this.port.postMessage(this.buffer.slice(0, this.idx));
        this.idx = 0;
      }
    }
    return true;
  }
}
registerProcessor('capture-processor', CaptureProcessor);
`;

function resampleLinear(
  input: Float32Array,
  fromRate: number,
  toRate: number
): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const outputLength = Math.floor(input.length / ratio);
  const output = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const srcIdx = i * ratio;
    const idx0 = Math.floor(srcIdx);
    const idx1 = Math.min(idx0 + 1, input.length - 1);
    const frac = srcIdx - idx0;
    output[i] = input[idx0] * (1 - frac) + input[idx1] * frac;
  }
  return output;
}

export function int16ToBase64(samples: Int16Array): string {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToInt16(base64: string): Int16Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
}

export type AudioChunkHandler = (samples: Int16Array, level: number) => void;

export class AudioCapture {
  private context?: AudioContext;
  private source?: MediaStreamAudioSourceNode;
  private worklet?: AudioWorkletNode;
  private processor?: ScriptProcessorNode;
  private silentGain?: GainNode;
  private workletUrl?: string;
  private stream?: MediaStream;
  private ownsStream = false;
  private muted = false;
  private readonly onChunk: AudioChunkHandler;

  constructor(onChunk: AudioChunkHandler) {
    this.onChunk = onChunk;
  }

  async start(stream?: MediaStream) {
    if (stream) {
      this.stream = stream;
      this.ownsStream = false;
    } else {
      // Echo cancellation MUST be on. Without it the speaker's audio (Gemini's voice)
      // bleeds back into the mic, the server VAD interprets it as the user interrupting,
      // and the model cuts itself mid-sentence.
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      this.ownsStream = true;
    }
    const track = this.stream.getAudioTracks()[0];
    if (track) {
      const settings = track.getSettings();
      console.log(
        `[audio] mic device="${track.label}" muted=${track.muted} enabled=${track.enabled} settings=`,
        settings
      );
    }
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.context = new Ctor();
    const nativeRate = this.context.sampleRate;
    console.log(
      `[audio] capture native=${nativeRate} -> resampling to ${INPUT_SAMPLE_RATE}`
    );

    if (this.context.state === "suspended") {
      try {
        await this.context.resume();
      } catch {
        /* noop */
      }
    }

    this.source = this.context.createMediaStreamSource(this.stream);

    // Try AudioWorklet first (iOS 14.5+, all modern Safari/Chrome).
    // Fallback to ScriptProcessorNode for older Safari.
    const supportsWorklet =
      typeof AudioWorkletNode !== "undefined" && !!this.context.audioWorklet;

    if (supportsWorklet) {
      try {
        const blob = new Blob([CAPTURE_WORKLET_CODE], {
          type: "application/javascript",
        });
        this.workletUrl = URL.createObjectURL(blob);
        await this.context.audioWorklet.addModule(this.workletUrl);
        this.worklet = new AudioWorkletNode(this.context, "capture-processor");
        this.worklet.port.onmessage = (e: MessageEvent<Float32Array>) => {
          if (this.muted) return;
          this.processChunk(e.data, nativeRate);
        };
        this.source.connect(this.worklet);
        // Terminate the audio graph through a silent gain to keep the worklet alive on iOS.
        this.silentGain = this.context.createGain();
        this.silentGain.gain.value = 0;
        this.worklet.connect(this.silentGain);
        this.silentGain.connect(this.context.destination);
        console.log("[audio] capture: AudioWorklet active");
        return;
      } catch (err) {
        console.warn(
          "[audio] AudioWorklet failed, falling back to ScriptProcessor:",
          err
        );
      }
    }

    // Fallback path (older Safari only)
    this.processor = this.context.createScriptProcessor(CAPTURE_BUFFER_SIZE, 1, 1);
    this.processor.onaudioprocess = (e) => {
      if (this.muted) return;
      this.processChunk(e.inputBuffer.getChannelData(0), nativeRate);
    };
    this.source.connect(this.processor);
    this.silentGain = this.context.createGain();
    this.silentGain.gain.value = 0;
    this.processor.connect(this.silentGain);
    this.silentGain.connect(this.context.destination);
    console.log("[audio] capture: ScriptProcessor fallback");
  }

  private processChunk(float32: Float32Array, nativeRate: number) {
    const resampled = resampleLinear(float32, nativeRate, INPUT_SAMPLE_RATE);
    const samples = new Int16Array(resampled.length);
    let sumSquares = 0;
    for (let i = 0; i < resampled.length; i++) {
      const s = Math.max(-1, Math.min(1, resampled[i]));
      samples[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      sumSquares += s * s;
    }
    const rms = Math.sqrt(sumSquares / resampled.length);
    this.onChunk(samples, rms);
  }

  setMuted(muted: boolean) {
    this.muted = muted;
  }

  stop() {
    try {
      this.worklet?.disconnect();
      this.processor?.disconnect();
      this.source?.disconnect();
      this.silentGain?.disconnect();
    } catch {
      /* noop */
    }
    // Only stop tracks if we created the stream ourselves; otherwise the parent
    // (page.tsx) owns the camera+mic stream lifecycle.
    if (this.ownsStream) {
      this.stream?.getTracks().forEach((t) => t.stop());
    }
    if (this.workletUrl) {
      URL.revokeObjectURL(this.workletUrl);
      this.workletUrl = undefined;
    }
    this.context?.close();
    this.worklet = undefined;
    this.processor = undefined;
    this.source = undefined;
    this.silentGain = undefined;
    this.stream = undefined;
    this.context = undefined;
  }
}

export class AudioPlayer {
  private context: AudioContext;
  private nativeRate: number;
  private playTime: number;
  private active: AudioBufferSourceNode[] = [];

  constructor() {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    // CRITICAL for iOS Safari: do NOT pass an explicit sampleRate. iPhone runs the audio
    // hardware at its native rate (typically 48000) and `new AudioContext({ sampleRate: 24000 })`
    // either throws or causes the timeline to drift after the first buffer. We resample
    // the 24kHz PCM coming from Gemini up to native rate inside enqueue().
    this.context = new Ctor();
    this.nativeRate = this.context.sampleRate;
    this.playTime = this.context.currentTime;
    console.log(
      `[audio] player native=${this.nativeRate}, source PCM=${OUTPUT_SAMPLE_RATE}`
    );
  }

  async resume() {
    if (this.context.state === "suspended") {
      await this.context.resume();
    }
  }

  enqueueBase64(base64: string) {
    const samples = base64ToInt16(base64);
    this.enqueue(samples);
  }

  enqueue(samples: Int16Array) {
    if (samples.length === 0) return;
    // Convert PCM16 -> Float32 -> resample 24kHz -> native if needed
    const float32 = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) float32[i] = samples[i] / 0x8000;
    const resampled =
      this.nativeRate === OUTPUT_SAMPLE_RATE
        ? float32
        : resampleLinear(float32, OUTPUT_SAMPLE_RATE, this.nativeRate);
    const buffer = this.context.createBuffer(1, resampled.length, this.nativeRate);
    buffer.getChannelData(0).set(resampled);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    const start = Math.max(this.context.currentTime + 0.02, this.playTime);
    source.start(start);
    source.onended = () => {
      this.active = this.active.filter((s) => s !== source);
    };
    this.active.push(source);
    this.playTime = start + buffer.duration;
  }

  interrupt() {
    for (const source of this.active) {
      try {
        source.stop();
      } catch {
        /* already stopped */
      }
    }
    this.active = [];
    this.playTime = this.context.currentTime;
  }

  close() {
    this.interrupt();
    this.context.close();
  }
}

export async function captureFrameJpegBase64(
  video: HTMLVideoElement,
  maxEdge = 768,
  quality = 0.7
): Promise<string | null> {
  if (!video.videoWidth || !video.videoHeight) return null;
  const ratio = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight));
  const w = Math.round(video.videoWidth * ratio);
  const h = Math.round(video.videoHeight * ratio);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, w, h);
  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : null;
}

export const INPUT_SAMPLE_RATE = 16000;
export const OUTPUT_SAMPLE_RATE = 24000;
const CAPTURE_BUFFER_SIZE = 4096;

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
  private processor?: ScriptProcessorNode;
  private stream?: MediaStream;
  private muted = false;
  private readonly onChunk: AudioChunkHandler;

  constructor(onChunk: AudioChunkHandler) {
    this.onChunk = onChunk;
  }

  async start(stream?: MediaStream) {
    this.stream =
      stream ??
      (await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: true,
          channelCount: 1,
        },
      }));
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
    // Use device's native sample rate; we resample to 16kHz manually
    this.context = new Ctor();
    const nativeRate = this.context.sampleRate;
    console.log(
      `[audio] native sample rate=${nativeRate} -> resampling to ${INPUT_SAMPLE_RATE}`
    );
    this.source = this.context.createMediaStreamSource(this.stream);
    this.processor = this.context.createScriptProcessor(CAPTURE_BUFFER_SIZE, 1, 1);
    this.processor.onaudioprocess = (e) => {
      if (this.muted) return;
      const float32 = e.inputBuffer.getChannelData(0);
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
    };
    this.source.connect(this.processor);
    const silentGain = this.context.createGain();
    silentGain.gain.value = 0;
    this.processor.connect(silentGain);
    silentGain.connect(this.context.destination);
  }

  setMuted(muted: boolean) {
    this.muted = muted;
  }

  stop() {
    try {
      this.processor?.disconnect();
      this.source?.disconnect();
    } catch {
      /* noop */
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.context?.close();
    this.processor = undefined;
    this.source = undefined;
    this.stream = undefined;
    this.context = undefined;
  }
}

export class AudioPlayer {
  private context: AudioContext;
  private playTime: number;
  private active: AudioBufferSourceNode[] = [];

  constructor() {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.context = new Ctor({ sampleRate: OUTPUT_SAMPLE_RATE });
    this.playTime = this.context.currentTime;
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
    const buffer = this.context.createBuffer(1, samples.length, OUTPUT_SAMPLE_RATE);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) data[i] = samples[i] / 0x8000;
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

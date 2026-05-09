import Link from "next/link";
import {
  IconArrowRight,
  IconBook,
  IconBookmark,
  IconEye,
  IconMapPin,
  IconPalette,
  IconSparkles,
} from "@tabler/icons-react";

export default function Home() {
  return (
    <main className="min-h-[100svh] bg-[var(--bg)] text-[var(--foreground)] antialiased">
      <div className="mx-auto max-w-[420px] px-4 pb-10 pt-5">
        {/* === Top nav === */}
        <header className="reveal reveal-1 mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="grid h-9 w-9 place-items-center rounded-[10px] bg-gradient-to-br from-[var(--blue-400)] to-[var(--blue-700)] text-white shadow-[0_0_24px_-2px_rgba(59,130,246,0.55)]"
            >
              <IconSparkles size={18} stroke={2.25} />
            </span>
            <span className="font-display text-[15px] font-semibold tracking-tight text-white">
              AccessLens
            </span>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--hairline)] bg-[var(--bg-card)] px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.28em] text-white/75">
            <span className="live-dot" /> en vivo
          </span>
        </header>

        {/* === Bento grid === */}
        <div className="grid grid-cols-2 gap-3">
          {/* HERO — full width, gradient blue */}
          <Link
            href="/live"
            className="reveal reveal-2 hero-grad group col-span-2 relative flex flex-col justify-between overflow-hidden rounded-[18px] p-6 text-white"
            style={{ minHeight: 220 }}
          >
            <div className="relative z-10 flex items-center gap-2 self-start rounded-full border border-white/30 bg-white/10 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.28em] backdrop-blur">
              <IconSparkles size={11} stroke={2.5} />
              gemini live · multimodal
            </div>

            <div className="relative z-10">
              <h1 className="font-display text-[38px] font-black leading-[0.95] tracking-[-0.02em]">
                Tus ojos.
                <br />
                <span className="text-white/85">Tu guía con IA.</span>
              </h1>
              <p className="mt-3 max-w-[28ch] text-[13px] leading-snug text-white/75">
                Apunta la cámara y AccessLens ve, escucha y te habla en 97
                idiomas. Sin descargar nada.
              </p>
            </div>

            {/* Decorative orbs */}
            <span
              aria-hidden
              className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/15 blur-2xl"
            />
            <span
              aria-hidden
              className="pointer-events-none absolute -bottom-12 -right-4 h-32 w-32 rounded-full bg-[var(--blue-300)]/20 blur-2xl"
            />
          </Link>

          {/* STAT — "97 idiomas" with audio bars */}
          <div
            className="reveal reveal-3 card relative flex flex-col justify-between p-5"
            style={{ minHeight: 152 }}
          >
            <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-white/55">
              idiomas
            </div>
            <div>
              <div className="font-display text-[58px] font-black leading-none tracking-tight text-[var(--blue-400)] stat-glow">
                97
              </div>
              <div className="mt-2 text-[11px] leading-tight text-white/55">
                detección automática
              </div>
            </div>
            <div className="audio-bars">
              <span /><span /><span /><span /><span /><span /><span />
            </div>
          </div>

          {/* MODE 1 — Describe */}
          <ModeCard
            delay="reveal-3"
            num="01"
            label="Describe"
            tagline="lo que ve la cámara"
            Icon={IconEye}
          />

          {/* MODE 2 — Lee */}
          <ModeCard
            delay="reveal-4"
            num="02"
            label="Lee"
            tagline="y traduce texto"
            Icon={IconBook}
          />

          {/* MODE 3 — Visualiza */}
          <ModeCard
            delay="reveal-4"
            num="03"
            label="Visualiza"
            tagline="diagramas al vuelo"
            Icon={IconPalette}
          />

          {/* MODE 4 — Orienta */}
          <ModeCard
            delay="reveal-5"
            num="04"
            label="Orienta"
            tagline="en el espacio"
            Icon={IconMapPin}
          />

          {/* MEMORIA — full width feature */}
          <div
            className="reveal reveal-5 card col-span-2 relative flex items-center gap-4 p-5"
            style={{ minHeight: 96 }}
          >
            <span
              aria-hidden
              className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-[var(--blue-900)]/40 text-[var(--blue-300)] ring-1 ring-inset ring-[var(--hairline-strong)]"
            >
              <IconBookmark size={22} stroke={1.75} />
            </span>
            <div className="flex-1">
              <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-white/55">
                memorias persistentes
              </div>
              <div className="mt-0.5 font-display text-[15px] font-semibold text-white">
                Guarda lo que ves, escúchalo después.
              </div>
            </div>
          </div>

          {/* CTA — full width */}
          <Link
            href="/live"
            className="reveal reveal-6 group col-span-2 relative flex h-[68px] items-center justify-between overflow-hidden rounded-[18px] bg-[var(--blue-600)] px-6 text-white shadow-[0_8px_28px_-8px_rgba(37,99,235,0.65)] transition active:scale-[0.99]"
          >
            <span
              aria-hidden
              className="absolute inset-0 -z-0 bg-gradient-to-r from-transparent via-white/15 to-transparent opacity-0 transition group-hover:opacity-100"
            />
            <div className="relative z-10 flex flex-col items-start leading-none">
              <span className="font-mono text-[9px] uppercase tracking-[0.28em] opacity-80">
                start session
              </span>
              <span className="mt-1 font-display text-[20px] font-black tracking-tight">
                Empezar
              </span>
            </div>
            <span
              aria-hidden
              className="relative z-10 grid h-11 w-11 place-items-center rounded-xl bg-white/15 transition group-hover:translate-x-1"
            >
              <IconArrowRight size={20} stroke={2.5} />
            </span>
          </Link>

          {/* Subtitle / footer line — wide card */}
          <div className="reveal reveal-6 card col-span-2 px-5 py-3 text-center font-mono text-[10px] uppercase tracking-[0.32em] text-white/45">
            solo abre la url y empieza · requiere mic · cámara
          </div>
        </div>
      </div>
    </main>
  );
}

function ModeCard({
  delay,
  num,
  label,
  tagline,
  Icon,
}: {
  delay: string;
  num: string;
  label: string;
  tagline: string;
  Icon: React.ComponentType<{ size?: number; stroke?: number }>;
}) {
  return (
    <div
      className={`reveal ${delay} card relative flex flex-col justify-between p-4`}
      style={{ minHeight: 122 }}
    >
      <span
        aria-hidden
        className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--blue-900)]/40 text-[var(--blue-300)] ring-1 ring-inset ring-[var(--hairline)]"
      >
        <Icon size={18} stroke={1.85} />
      </span>
      <div>
        <div className="font-mono text-[9px] uppercase tracking-[0.28em] text-white/40">
          {num}
        </div>
        <div className="mt-0.5 font-display text-[17px] font-bold leading-tight text-white">
          {label}
        </div>
        <div className="text-[11px] leading-tight text-white/55">{tagline}</div>
      </div>
    </div>
  );
}

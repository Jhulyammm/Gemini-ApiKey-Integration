import Link from "next/link";
import {
  IconArrowRight,
  IconBook,
  IconBookmark,
  IconMessage2,
  IconEye,
  IconMapPin,
  IconPhone,
  IconSparkles,
} from "@tabler/icons-react";
import { SensLogo } from "@/components/SensLogo";

export default function Home() {
  return (
    <main className="min-h-[100svh] bg-[var(--bg)] text-[var(--foreground)] antialiased">
      <div className="mx-auto w-full max-w-[460px] px-4 pb-10 pt-5 md:max-w-[920px] md:px-8 md:pt-10 lg:max-w-[1080px]">
        {/* === Top nav === */}
        <header className="reveal reveal-1 mb-5 flex items-center justify-between md:mb-8">
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="grid h-10 w-10 place-items-center rounded-[10px] bg-[var(--blue-900)] text-white shadow-[0_0_24px_-2px_rgba(59,130,246,0.55)] md:h-11 md:w-11"
            >
              <SensLogo size={22} strokeWidth={7} />
            </span>
            <span className="font-display text-[16px] font-semibold tracking-tight text-white md:text-[18px]">
              Sens
            </span>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--hairline)] bg-[var(--bg-card)] px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.28em] text-white/75 md:px-3 md:py-1.5 md:text-[10px]">
            <span className="live-dot" /> en vivo
          </span>
        </header>

        {/* === Bento grid === */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-6 md:gap-4">
          {/* HERO — full width on mobile, spans 4 cols on desktop */}
          <Link
            href="/live"
            className="reveal reveal-2 hero-grad group relative col-span-2 flex flex-col justify-between overflow-hidden rounded-[18px] p-6 text-white md:col-span-4 md:row-span-2 md:p-10"
            style={{ minHeight: 220 }}
          >
            <div className="relative z-10 flex items-center gap-2 self-start rounded-full border border-white/30 bg-white/10 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.28em] backdrop-blur md:text-[10px]">
              <IconSparkles size={11} stroke={2.5} />
              gemini live · multimodal · 97 idiomas
            </div>

            <div className="relative z-10 mt-12 md:mt-0">
              <h1 className="font-display text-[40px] font-black leading-[0.95] tracking-[-0.02em] md:text-[68px]">
                Tus ojos.
                <br />
                <span className="text-white/85">Tu guía con IA.</span>
              </h1>
              <p className="mt-3 max-w-[28ch] text-[13px] leading-snug text-white/80 md:mt-5 md:max-w-[40ch] md:text-[16px]">
                Apunta la cámara y Sens ve, escucha y te habla. Sin descargar
                nada, sin teclear: solo tu voz.
              </p>
            </div>

            <span
              aria-hidden
              className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/15 blur-2xl md:h-64 md:w-64"
            />
            <span
              aria-hidden
              className="pointer-events-none absolute -bottom-12 -right-4 h-32 w-32 rounded-full bg-[var(--blue-300)]/20 blur-2xl md:h-48 md:w-48"
            />
          </Link>

          {/* STAT — "97 idiomas" */}
          <div
            className="reveal reveal-3 card relative flex flex-col justify-between p-5 md:col-span-2"
            style={{ minHeight: 152 }}
          >
            <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-white/55">
              idiomas
            </div>
            <div>
              <div className="font-display text-[58px] font-black leading-none tracking-tight text-[var(--blue-400)] stat-glow md:text-[72px]">
                97
              </div>
              <div className="mt-2 text-[11px] leading-tight text-white/55 md:text-[12px]">
                detección automática
              </div>
            </div>
            <div className="audio-bars">
              <span /><span /><span /><span /><span /><span /><span />
            </div>
          </div>

          {/* CAPABILITY 1 — Describe */}
          <CapabilityCard
            delay="reveal-3"
            num="01"
            label="Describe"
            tagline="lo que ve la cámara"
            Icon={IconEye}
          />

          {/* CAPABILITY 2 — Lee */}
          <CapabilityCard
            delay="reveal-4"
            num="02"
            label="Lee"
            tagline="y traduce texto"
            Icon={IconBook}
          />

          {/* CAPABILITY 3 — Orienta */}
          <CapabilityCard
            delay="reveal-4"
            num="03"
            label="Orienta"
            tagline="con búsqueda real"
            Icon={IconMapPin}
          />

          {/* CAPABILITY 4 — Acciones */}
          <CapabilityCard
            delay="reveal-5"
            num="04"
            label="Llama"
            tagline="por ti, manos libres"
            Icon={IconPhone}
          />

          {/* MEMORIA — feature card */}
          <div
            className="reveal reveal-5 card relative flex items-center gap-4 p-5 col-span-2 md:col-span-3"
            style={{ minHeight: 96 }}
          >
            <span
              aria-hidden
              className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-[var(--blue-900)]/40 text-[var(--blue-300)] ring-1 ring-inset ring-[var(--hairline-strong)]"
            >
              <IconBookmark size={22} stroke={1.75} />
            </span>
            <div className="flex-1 min-w-0">
              <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-white/55">
                memorias persistentes
              </div>
              <div className="mt-0.5 font-display text-[15px] font-semibold leading-tight text-white md:text-[16px]">
                Guarda lo que ves, escúchalo después.
              </div>
            </div>
          </div>

          {/* SUBTÍTULOS — accessibility flex */}
          <div
            className="reveal reveal-5 card relative flex items-center gap-4 p-5 col-span-2 md:col-span-3"
            style={{ minHeight: 96 }}
          >
            <span
              aria-hidden
              className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-[var(--blue-900)]/40 text-[var(--blue-300)] ring-1 ring-inset ring-[var(--hairline-strong)]"
            >
              <IconMessage2 size={22} stroke={1.75} />
            </span>
            <div className="flex-1 min-w-0">
              <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-white/55">
                voz a texto en vivo
              </div>
              <div className="mt-0.5 font-display text-[15px] font-semibold leading-tight text-white md:text-[16px]">
                Subtítulos enormes. Para todos.
              </div>
            </div>
          </div>

          {/* CTA — full width */}
          <Link
            href="/live"
            className="reveal reveal-6 group relative flex h-[68px] items-center justify-between overflow-hidden rounded-[18px] bg-[var(--blue-600)] px-6 text-white shadow-[0_8px_28px_-8px_rgba(37,99,235,0.65)] transition active:scale-[0.99] col-span-2 md:col-span-6 md:h-[80px] md:px-8"
          >
            <span
              aria-hidden
              className="absolute inset-0 -z-0 bg-gradient-to-r from-transparent via-white/15 to-transparent opacity-0 transition group-hover:opacity-100"
            />
            <div className="relative z-10 flex flex-col items-start leading-none">
              <span className="font-mono text-[9px] uppercase tracking-[0.28em] opacity-80 md:text-[10px]">
                start session
              </span>
              <span className="mt-1 font-display text-[20px] font-black tracking-tight md:text-[26px]">
                Empezar
              </span>
            </div>
            <span
              aria-hidden
              className="relative z-10 grid h-11 w-11 place-items-center rounded-xl bg-white/15 transition group-hover:translate-x-1 md:h-14 md:w-14"
            >
              <IconArrowRight size={20} stroke={2.5} />
            </span>
          </Link>

          {/* Footer line */}
          <div className="reveal reveal-6 card col-span-2 px-5 py-3 text-center font-mono text-[10px] uppercase tracking-[0.32em] text-white/45 md:col-span-6 md:py-4 md:text-[11px]">
            solo abre la url y empieza · requiere mic · cámara
          </div>
        </div>
      </div>
    </main>
  );
}

function CapabilityCard({
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
      className={`reveal ${delay} card relative flex flex-col justify-between p-4 md:p-5`}
      style={{ minHeight: 122 }}
    >
      <span
        aria-hidden
        className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--blue-900)]/40 text-[var(--blue-300)] ring-1 ring-inset ring-[var(--hairline)] md:h-10 md:w-10"
      >
        <Icon size={18} stroke={1.85} />
      </span>
      <div>
        <div className="font-mono text-[9px] uppercase tracking-[0.28em] text-white/40">
          {num}
        </div>
        <div className="mt-0.5 font-display text-[17px] font-bold leading-tight text-white md:text-[19px]">
          {label}
        </div>
        <div className="text-[11px] leading-tight text-white/55 md:text-[12px]">
          {tagline}
        </div>
      </div>
    </div>
  );
}

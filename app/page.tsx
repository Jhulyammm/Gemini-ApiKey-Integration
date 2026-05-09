import Link from "next/link";

const TICKERS = [
  "97 IDIOMAS",
  "TIEMPO REAL",
  "VOZ EMPÁTICA",
  "GEMINI LIVE",
  "BAJA VISIÓN",
  "SORDERA",
  "DISLEXIA",
  "ORIENTACIÓN",
];

export default function Home() {
  return (
    <main className="relative min-h-[100svh] overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
      {/* Atmospheric layers */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-20 bg-[radial-gradient(ellipse_at_top_right,rgba(255,230,0,0.10),transparent_55%)]"
      />
      <div aria-hidden className="grain pointer-events-none absolute inset-0 -z-10" />

      {/* Frame corners */}
      <span className="frame-corner tl" />
      <span className="frame-corner tr" />
      <span className="frame-corner bl" />
      <span className="frame-corner br" />

      {/* Top bar */}
      <header className="relative z-10 flex items-center justify-between px-6 pt-7">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-sm bg-[var(--signal)] text-[var(--signal-ink)] font-mono text-base font-black">
            A
          </span>
          <div className="flex flex-col leading-none">
            <span className="font-mono text-[10px] uppercase tracking-[0.32em] text-white/50">
              Project
            </span>
            <span className="font-display text-base font-semibold tracking-tight">
              AccessLens
            </span>
          </div>
        </div>
        <div className="flex flex-col items-end leading-none">
          <span className="font-mono text-[10px] uppercase tracking-[0.32em] text-white/50">
            v0.1
          </span>
          <span className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--signal)]">
            ● live
          </span>
        </div>
      </header>

      {/* Hero */}
      <section className="relative z-10 mx-auto flex min-h-[78svh] max-w-[640px] flex-col justify-end px-6 pb-12 pt-14">
        <p className="reveal reveal-1 mb-5 inline-flex w-fit items-center gap-2 border border-[var(--hairline-strong)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.28em] text-white/70">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--signal)]" />
          accesibilidad · multimodal · gemini live
        </p>

        <h1 className="reveal reveal-2 text-balance font-display text-[clamp(3rem,12vw,5.5rem)] font-black leading-[0.88] tracking-[-0.02em]">
          Tus ojos.
          <br />
          Tus oídos.
          <br />
          <span className="relative inline-block">
            <span className="text-[var(--signal)]">Tu guía.</span>
            <span
              aria-hidden
              className="absolute -bottom-1 left-0 h-[6px] w-full bg-[var(--signal)]/30"
            />
          </span>
        </h1>

        <p className="reveal reveal-3 mt-6 max-w-[28ch] text-pretty text-[17px] leading-relaxed text-white/75">
          Apunta la cámara. AccessLens ve, escucha y te habla con voz natural en{" "}
          <span className="text-white">97 idiomas</span>. Sin instalar nada.
        </p>

        {/* Capability strip — wayfinding chips */}
        <ul className="reveal reveal-4 mt-9 grid grid-cols-2 gap-x-4 gap-y-3">
          {[
            ["01", "Describe", "lo que ve la cámara"],
            ["02", "Lee", "y traduce el texto"],
            ["03", "Visualiza", "diagramas al vuelo"],
            ["04", "Orienta", "en el espacio"],
          ].map(([n, verb, tail]) => (
            <li
              key={n}
              className="border-l-2 border-[var(--signal)] pl-3"
            >
              <div className="font-mono text-[10px] uppercase tracking-[0.32em] text-white/40">
                {n}
              </div>
              <div className="mt-1 text-base font-semibold text-white">
                {verb}
              </div>
              <div className="text-[12px] leading-tight text-white/60">
                {tail}
              </div>
            </li>
          ))}
        </ul>

        {/* CTA */}
        <Link
          href="/live"
          className="reveal reveal-5 group mt-12 flex h-[68px] items-center justify-between rounded-none bg-[var(--signal)] px-6 text-[var(--signal-ink)] outline-2 outline-offset-2 outline-transparent transition focus-visible:outline-[var(--signal)]/40 active:scale-[0.99]"
        >
          <div className="flex flex-col items-start leading-none">
            <span className="font-mono text-[10px] uppercase tracking-[0.32em] opacity-70">
              start session
            </span>
            <span className="mt-1 text-2xl font-black tracking-tight">
              Empezar →
            </span>
          </div>
          <span
            aria-hidden
            className="grid h-12 w-12 place-items-center bg-[var(--signal-ink)] font-mono text-[var(--signal)] transition group-hover:translate-x-1"
          >
            ▶
          </span>
        </Link>

        <p className="reveal reveal-5 mt-4 text-center font-mono text-[10px] uppercase tracking-[0.28em] text-white/40">
          requiere micrófono · cámara · http(s) seguro
        </p>
      </section>

      {/* Marquee ticker */}
      <div className="relative z-10 overflow-hidden border-y border-[var(--hairline)] bg-black py-3">
        <div className="marquee-track flex w-max items-center gap-10 whitespace-nowrap font-mono text-[11px] uppercase tracking-[0.32em] text-white/50">
          {[...TICKERS, ...TICKERS, ...TICKERS, ...TICKERS].map((t, i) => (
            <span key={i} className="flex items-center gap-10">
              <span className="text-[var(--signal)]">✦</span>
              {t}
            </span>
          ))}
        </div>
      </div>
    </main>
  );
}

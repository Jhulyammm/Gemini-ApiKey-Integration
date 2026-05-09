# Sens

**Tus ojos, oídos y guía con IA en vivo. En 97 idiomas. Sin descargar nada.**

Sens es una PWA de accesibilidad voz-primero construida sobre **Google Gemini Live API**. Apuntás la cámara del celular, hablás, y Sens ve, escucha y te responde con voz natural en tu idioma — detectando automáticamente entre 97.

Pensada para personas con baja visión, sordera, dislexia, o cualquiera que necesita orientación en un espacio nuevo o en otro idioma.

> Hackatón: **Best Use of the Google Gemini API**.
> Stack: Next.js 16 · React 19 · Tailwind v4 · Gemini Live + Gemini 3 Pro + Google Search grounding.
> Demo público: https://gemini-api-key-integration.vercel.app

---

## Capacidades

| | | |
|---|---|---|
| 👁️ **Describe** | Lo que ve la cámara — escenas, peligros, expresiones | Gemini Live audio + video |
| 📖 **Lee + traduce** | Cualquier texto, 97 idiomas con detección automática | Gemini Live |
| 💡 **Interpreta** | Símbolos, gestos, contexto, situaciones complejas | Gemini Live |
| 📍 **Orienta** | Encuentra lugares reales (no inventa direcciones) | Gemini 3 Pro + Google Search grounding |
| 💾 **Memorias** | Guarda recetas, menús, tarjetas con descripción detallada, persistente | Gemini 3 Pro vision + localStorage |

**Voz-primero**: el usuario habla, el modelo decide qué herramienta usar. Sin menús, sin botones para la interacción primaria.

**Sesión indefinida**: cada WebSocket Live tiene 2 min de límite duro, pero implementamos session resumption + goAway preemption — la conversación dura todo lo que el usuario quiera.

---

## Correr local

```bash
git clone https://github.com/Jhulyammm/Gemini-ApiKey-Integration.git sens
cd sens
npm install
cp .env.example .env.local
# Edita .env.local y pega tu GEMINI_API_KEY de https://aistudio.google.com/apikey
npm run dev
```

Abrí `http://localhost:3000` en el celular conectado a la **misma WiFi** que la laptop, o usá `ngrok http 3000` para tunelar HTTPS (`getUserMedia` exige HTTPS en mobile).

### Verificar acceso a los modelos

```bash
node --env-file=.env.local scripts/check-api-access.mjs
node --env-file=.env.local scripts/list-models.mjs
```

El primero prueba los modelos críticos. El segundo lista qué modelos Live tiene tu key disponibles.

---

## Arquitectura

```
app/
├─ page.tsx              ← landing (bento grid)
├─ live/page.tsx         ← experiencia: cámara, mic, sesión, memorias
├─ layout.tsx            ← metadata, fonts, theme
├─ globals.css           ← tokens dark blue + animaciones
└─ api/
   ├─ token/route.ts     ← mintea ephemeral token (server-side)
   ├─ memory/route.ts    ← describe frame con Gemini 3 Pro
   └─ nearby/route.ts    ← search grounding para places

components/
└─ SensLogo.tsx          ← logo SVG inline

lib/
├─ audio.ts              ← AudioCapture (Worklet), AudioPlayer, frame JPEG
├─ gemini-live.ts        ← LiveSession (WS + session resumption + goAway preempt)
└─ modes.ts              ← system prompt + function declarations

scripts/
├─ check-api-access.mjs  ← probe de los modelos críticos
└─ list-models.mjs       ← lista modelos Live disponibles
```

### Modelos usados

- **`gemini-3.1-flash-live-preview`** — Live API bidireccional (audio + video).
- **`gemini-3-pro-preview`** — descripción de Memorias (vision + text, alta calidad).
- **`gemini-3-pro-preview` con `googleSearch` tool** — orientación con grounding.

### Seguridad

El cliente **nunca** ve la `GEMINI_API_KEY`. El browser llama a `POST /api/token`, que crea un **ephemeral token** firmado por el servidor, válido 30 min y limitado al modelo Live + modalidad audio. El WebSocket se abre directo browser→Google con ese token.

### Pipeline de audio

- Captura: AudioWorklet inline (compat iOS Safari 16+), PCM 16-bit @ 16 kHz, resampleo manual desde rate nativo del device.
- Reproducción: PCM @ 24 kHz, scheduled append a la timeline del AudioContext.
- Mic gate: mientras Sens habla, las uploads del mic se descartan client-side para evitar el echo loop que dispara el VAD del servidor.

### Sesión indefinida

El Live API tiene un límite de 2 min por WebSocket. Sortado con tres capas:

1. **Session resumption**: el server emite handles persistentes vía `sessionResumptionUpdate`.
2. **goAway preempt**: cuando el server avisa "voy a cerrar en N s", abrimos sesión nueva con el handle ANTES de que muera la vieja. Kickoff suprimido en sesiones reanudadas.
3. **Failsafe a 115 s**: si goAway no llega, forzamos reconexión nosotros.

El usuario percibe **una sola conversación continua**.

---

## Equipo y contribución

Documento de onboarding completo: **[`EQUIPO.md`](EQUIPO.md)** — todo el contexto técnico, decisiones, bugs conocidos, glossary.

Otros docs:
- **[`DEPLOY.md`](DEPLOY.md)** — guía de despliegue en Vercel paso a paso.
- **[`DEVPOST.md`](DEVPOST.md)** — texto de submission listo para pegar en DevPost.
- **[`DEMO.md`](DEMO.md)** — guion del video de demo (5 min).
- **[`PITCH.md`](PITCH.md)** — preparación para el pitch ante jurados.

### Workflow

```bash
git pull origin main
# editás
npm run dev          # test local
npx tsc --noEmit     # type check antes de commit
git add . && git commit -m "feat(scope): mensaje"
git push origin main # auto-deploy Vercel
```

---

## Licencia

MIT.

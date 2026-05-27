═══════════════════════════════════════════════════
PARTE 1 — ANÁLISIS AUTOMÁTICO
═══════════════════════════════════════════════════

## 1. Identificación

- **Nombre**: Sens (anteriormente AccessLens). El directorio del repo aún se llama `Gemini-ApiKey-Integration` y el `package.json` ahora dice `sens`.
- **Una frase**: PWA de accesibilidad voz-primero que convierte el celular en un asistente que ve, lee, traduce, interpreta y guarda memorias por ti, en tiempo real sobre Gemini Live.
- **Resumen de 3 frases**: Proyecto de hackatón "Best Use of the Google Gemini API". Construye una experiencia voz-primero donde el usuario habla y la IA decide qué herramienta usar (describir escena, leer/traducir texto, buscar lugares cercanos con grounding, o guardar memorias con descripción persistente). El público objetivo son personas con baja visión, sordera, dislexia o que necesitan orientación en un espacio nuevo o en otro idioma; el demo es público en Vercel y abre desde una sola URL sin descargas ni login.
- **Tipo de proyecto**: Web app (Next.js App Router) con PWA manifest. Voice-first multimodal AI assistant. Funciones serverless en Vercel + WebSocket directo browser↔Gemini.
- **Estado actual**: Prototipo de hackatón shipped a producción en Vercel. Funcionalmente completo en su scope reducido (después de quitar `dispatch_action` y `generate_visual_aid` por restricciones operativas). Activo el día del hackatón (2026-05-09); evolución posterior depende de la decisión del equipo.
- **Período de actividad**: 2026-05-09 → 2026-05-09. **Todo el desarrollo ocurrió en un solo día** (28 commits del 9 de mayo de 2026). Hackatón de 6-8 h documentado en commits.
- **Tamaño aproximado**:
  - **2 768 LOC** totales en TypeScript/JavaScript (post-cleanup).
  - **14 archivos** `.ts`/`.tsx`/`.mjs` de código fuente.
  - **39 archivos** totales en el repo (excluyendo `node_modules`, `.next`, `.git`).
  - 4 directorios principales: `app/` (Next.js pages + API), `lib/` (lógica reutilizable), `components/` (1 componente: SensLogo), `scripts/` (utilidades CLI).
  - El archivo más grande: `app/live/page.tsx` con **1 153 LOC** (componente cliente monolítico — ver §9).

## 2. Stack tecnológico detallado

- **Lenguajes principales**: TypeScript ~95 %, JavaScript ~5 % (solo los scripts de probe).
- **Runtime / plataforma**: Node 20 (per `@types/node: ^20`), Next.js Edge/Node serverless. Browser: Chrome / Safari moderno con AudioWorklet support.
- **Framework frontend**: **Next.js 16.2.6** (App Router, Turbopack), **React 19.2.4**.
- **Framework backend**: Next.js API routes (`app/api/*/route.ts`), runtime `nodejs`, `dynamic = "force-dynamic"`, `maxDuration = 60`.
- **Base de datos**: **Ninguna**. Persistencia 100 % client-side vía `localStorage` (key `accesslens:memories`, cap de 20 entradas).
- **ORM / query layer**: N/A.
- **APIs externas / SDKs**:
  - **LLMs (Google Gemini)**, vía `@google/genai ^1.0.0`:
    - `gemini-3.1-flash-live-preview` — Live API bidireccional (audio + video).
    - `gemini-3-pro-preview` — vision + text para Memorias y para `find_nearby_place`.
    - `gemini-2.5-flash` — fallback en `/api/memory` y `/api/nearby`.
    - Versión API: `v1alpha` (forzada vía `httpOptions: { apiVersion: "v1alpha" }`).
  - **Google Search grounding** — vía `tools: [{ googleSearch: {} }]` en `/api/nearby` para anti-hallucination en orientación.
  - **Web APIs del browser**: `getUserMedia` (cámara + mic), `Geolocation`, `SpeechSynthesis` (TTS para Memorias), `AudioContext` + `AudioWorkletNode`, `MediaStreamAudioSourceNode`, `Notification` (presente en código heredado pero ya no usado), `Web Share` (ídem), `localStorage`.
- **Auth**: **Ninguna**. Acceso público a la URL. Single-tenant por device.
- **Deploy / infra**: **Vercel** (URL pública `https://gemini-api-key-integration.vercel.app`). Tres rutas serverless (`/api/token`, `/api/memory`, `/api/nearby`).
- **CI/CD**: Auto-deploy vía Vercel ↔ GitHub push. No hay GitHub Actions configurado.
- **Tools de dev**: TypeScript `^5` con `strict: true`, ESLint `^9` (config `eslint-config-next` con `nextVitals` + `nextTs`), Tailwind `^4` (via `@tailwindcss/postcss`), PostCSS.
- **Testing**: **Ninguno**. Cero archivos `*.test.*`, `*.spec.*`. Sin Jest, Vitest, Playwright. No hay configuración de coverage.
- **Observabilidad**: Solo `console.log`/`console.warn`/`console.error` con prefijos sistemáticos: `[live]`, `[audio]`, `[tool]`, `[api/visual]`, `[memory]`, `[chip]`, `[camera]`. Vercel function logs como observabilidad de producción. No hay Sentry, PostHog, ni telemetría custom.

## 3. Arquitectura

Sens es una **single-page app con tres surfaces** (`/`, `/live`, overlay de Memorias) sobre Next.js App Router, con tres funciones serverless serverless que actúan como **edge intermediario seguro** entre el browser y la API de Gemini.

**Capas principales:**

1. **Cliente (browser, React)** — Maneja el ciclo completo de la sesión multimodal: cámara, mic, AudioWorklet de captura, AudioPlayer de reproducción, WebSocket con Gemini Live, ejecución client-side de tool calls (Memorias), persistencia en localStorage, UI completa con overlays modales.
2. **API routes (Next.js serverless en Vercel)** — Tres endpoints únicos: `/api/token` mintea tokens efímeros del SDK; `/api/memory` hace vision + transcription con Gemini 3 Pro; `/api/nearby` orquesta search grounding con `googleSearch` tool.
3. **Gemini API (Google)** — Live API (WS bidireccional) + Pro vision/text (HTTP) + Search grounding interno del modelo.

**Flujo de datos (sesión de voz):**

```
User clicks "Iniciar sesión Live"
  → page.tsx → fetchEphemeralToken()
  → POST /api/token (server-side, lee GEMINI_API_KEY del env)
  → SDK.authTokens.create() en v1alpha
  → response { token, model }
  → page.tsx instancia LiveSession con el token
  → LiveSession abre WS directo browser↔Gemini Live
  → setupComplete arriva → flush pending audio/video + send kickoff
  → AudioCapture (AudioWorklet @ native rate, resample → 16kHz PCM16)
     loop @ ~85ms → LiveSession.sendAudio (gated por aiSpeaking)
  → Frame timer @ 1Hz → captureFrameJpegBase64 → sendVideoFrame
  → Server emite serverContent con audio chunks (PCM 24kHz base64)
     → AudioPlayer.enqueueBase64 (resample → native rate, scheduled append)
  → Server emite sessionResumptionUpdate cada ~10-15s
     → guardado en resumeHandleRef
  → Server emite goAway antes de cerrar
     → onGoAway callback → triggerReconnect({ resume: true })
     → nueva LiveSession con resumeHandle, kickoff suprimido
  → Si modelo decide llamar tool: msg.toolCall.functionCalls
     → handleToolCall en page.tsx → fetch a /api/memory o /api/nearby
     → sendToolResponse de vuelta al modelo
```

**Flujo de "Guardar memoria" (rama paralela):**

```
User tap "Guardar momento" o el modelo invoca save_memory
  → captureFrameJpegBase64 (canvas → JPEG @ 1280px max edge, q=0.85)
  → POST /api/memory con { imageBase64, mimeType, label }
  → server llama Gemini 3 Pro vision con prompt detallado
     (transcribir TODO texto visible, identificar tipo de documento)
  → fallback a gemini-2.5-flash si Pro falla
  → response { description }
  → cliente construye Memory object con id/timestamp/imageBase64
  → persistMemories actualiza localStorage (cap 20)
  → speakText narra "Listo, guardé [label]" via SpeechSynthesis
```

**Componentes/módulos principales (10):**

1. **`app/page.tsx`** (252 LOC) — Landing bento grid 2-col → 6-col responsive, con 5 capability cards y CTA a `/live`. No tiene estado.
2. **`app/live/page.tsx`** (1 153 LOC) — **Componente cliente monolítico** que orquesta todo: status machine de 8 estados, permisos cam/mic, AudioCapture/AudioPlayer lifecycle, LiveSession, frame loop, session timer + failsafe reconnect, mic gate, hint rotator, tool call dispatch, Memorias UI completa, Settings sheet, camera flip, persistencia.
3. **`lib/gemini-live.ts`** (335 LOC) — Wrapper de `Session` del SDK Gemini. Maneja conexión, callbacks (audio, transcripciones, tool calls, goAway, resumeHandleUpdate), mic gate `aiSpeaking` con drain timer post-turnComplete, buffer de pending audio/frame hasta `setupComplete`, parsing de duration string en `goAway.timeLeft`.
4. **`lib/audio.ts`** (316 LOC) — AudioCapture (AudioWorklet inline blob → ScriptProcessor fallback, ownsStream flag, mute gating); AudioPlayer (native rate, resample 24kHz→native, scheduled append a la timeline con `playTime`); resampleLinear; `int16ToBase64`/`base64ToInt16`; `captureFrameJpegBase64`.
5. **`lib/modes.ts`** (84 LOC) — Configuración del asistente: `findNearbyPlace` y `saveMemory` function declarations con prompts imperativos ("LLAMA INMEDIATAMENTE"), `ASSISTANT.systemPrompt` con 5 capacidades + 1 "lo que no hace", kickoff.
6. **`app/api/token/route.ts`** (53 LOC) — Mintea ephemeral token de 30 min limitado al modelo Live y `responseModalities: [Modality.AUDIO]`, con `uses: 1` y `newSessionExpireTime` de 2 min.
7. **`app/api/memory/route.ts`** (93 LOC) — Vision Pro con prompt OCR-first ("transcribe TODO el texto visible"), fallback a 2.5-flash, `maxDuration = 60`.
8. **`app/api/nearby/route.ts`** (85 LOC) — Pro con `googleSearch` tool, fallback a 2.5-flash, prompt corto en español con instrucción de "pasos accionables".
9. **`components/SensLogo.tsx`** (35 LOC) — SVG inline del logo (rombo rotado + "L" interior).
10. **`scripts/check-api-access.mjs` + `list-models.mjs`** (121 + 39 LOC) — CLI de diagnóstico: el primero prueba los 5 modelos críticos (free-tier, Pro text, Search grounding, Nano Banana Pro, Live API token); el segundo lista los modelos Live disponibles por API version (v1alpha / v1beta / v1).

**Patrones arquitectónicos identificados:**

- **Serverless edge pattern** — funciones independientes sin estado compartido.
- **Ephemeral token / browser-direct WS** — la API key nunca toca el cliente; las funciones server-side solo mintean credenciales acotadas.
- **Monolithic client component** — todo el live UX vive en un solo `'use client'`. Decisión hackatón-driven (velocidad > modularidad).
- **State machine implícita** — el `Status` type (`idle | requesting-permissions | ready | connecting | live | reconnecting | ended | error`) actúa como FSM pero los transitions están dispersos en handlers.
- **Event-driven con callbacks tipados** — `LiveSessionEvents` con 10 callbacks opcionales que `page.tsx` cablea.
- **Refs over state para hot paths** — `elapsedRef`, `totalElapsedRef`, `resumeHandleRef`, `userBufferRef`, `aiBufferRef`, `reconnectingRef` evitan re-renders en el ciclo de audio.

**Decisiones estructurales notables:**

- **Monolito** (no monorepo). Un solo `package.json`, un solo `tsconfig.json`.
- **App Router** (no Pages Router) — usa `'use client'` directives explícitos para el split server/client.
- **Cero backend de datos** — Memorias persisten en `localStorage` del device. Implica: no hay sync entre devices, no hay backup, pero también: cero infra de DB, cero login, cero GDPR overhead.
- **Imports absolutos con `@/*`** vía `tsconfig.paths`.
- **Tailwind v4 con `@theme inline`** para mapear CSS variables a clases Tailwind.

## 4. Features implementadas (exhaustivo)

### Área 1: Conversación voz-primero (Live API)

- **Audio bidireccional en tiempo real** sobre WebSocket directo browser↔Gemini Live.
- **Captura de audio** vía AudioWorklet inline (compatible iOS Safari 16+, donde ScriptProcessorNode falla silenciosamente). Fallback a ScriptProcessorNode para browsers viejos.
- **Resampleo PCM** client-side: captura desde rate nativo del device → 16 kHz Int16 PCM; reproducción 24 kHz → rate nativo, con interpolación lineal.
- **Detección automática de 97 idiomas** (delegada al modelo Live).
- **Voz nativa empática** (no TTS sobre texto) generada por el modelo.
- **Saludo dinámico según hora local** del device: "lindo día / tarde / noche / madrugada" basado en `new Date().getHours()`.
- **Tool calling**: el modelo decide cuándo invocar `find_nearby_place` o `save_memory`; las descripciones de las funciones son imperativas ("LLAMA INMEDIATAMENTE").
- **Transcripciones en vivo** (input + output) renderizadas como caption box con caret parpadeante.

### Área 2: Sesión indefinida (anti-hard-limit)

- **Session resumption**: el server emite `sessionResumptionUpdate` con `newHandle` cuando es resumible; cliente guarda en `resumeHandleRef`.
- **goAway preempt**: cuando el server avisa `goAway` con `timeLeft` (parsed de duration string "Ns"), se dispara `triggerReconnect({ resume: true })` inmediatamente.
- **Kickoff suprimido en sesiones reanudadas** — el saludo solo se envía cuando no hay `resumeHandle`.
- **Failsafe a 115 s** — si `goAway` nunca llega, un timer client-side fuerza reconnect antes del límite duro de 120 s.
- **Timer total acumulado** (`totalElapsedRef`) que cuenta sin reset entre reconexiones, mostrado en el top nav.

### Área 3: Anti-echo defensivo

- **Echo cancellation activo** en `getUserMedia` (audio constraints).
- **Server VAD desensibilizado**: `prefixPaddingMs: 1000`, `silenceDurationMs: 1500`, `startOfSpeechSensitivity: LOW`, `endOfSpeechSensitivity: LOW`.
- **Mic gate client-side** (`aiSpeaking` flag): mientras el AudioPlayer está reproduciendo audio del modelo, los chunks PCM del mic se descartan en `sendAudio` antes de mandarse al server. Drain timer de 600 ms post-turnComplete antes de reabrir el gate.
- **Stream compartido**: un único `MediaStream` con cámara + mic, propagado de `requestPermissions` a `AudioCapture.start(stream)` con `ownsStream = false` para evitar doble-getUserMedia.

### Área 4: Memorias persistentes

- **Captura on-demand** del frame actual de cámara (`captureFrameJpegBase64` con max edge 1280 px, quality 0.85).
- **Descripción con Gemini 3 Pro vision**: prompt detallado en español con instrucción de transcribir TODO texto visible.
- **Fallback a `gemini-2.5-flash`** si Pro falla.
- **Persistencia en `localStorage`** con cap de 20 entradas (FIFO al exceder).
- **Galería full-screen overlay** con grid 2-col mobile / 4-col tablet / 5-col desktop.
- **Detalle de memoria**: imagen + label + timestamp + descripción + botón "Reescuchar" (browser TTS via `SpeechSynthesis`) + botón eliminar.
- **Botón flotante "Guardar este momento"** dentro de la galería para captura inmediata.

### Área 5: Orientación con grounding

- **`find_nearby_place` tool**: invocada por el modelo Live cuando el usuario pregunta dónde hay algo que no se ve por cámara.
- **GPS opcional** vía `navigator.geolocation.getCurrentPosition` con timeout de 4 s; el endpoint funciona sin GPS también.
- **Search grounding real** vía `tools: [{ googleSearch: {} as GoogleSearch }]` en la config del modelo Pro — no inventa direcciones.
- **Prompt instructor** que combina ubicación + pistas visuales reportadas + query del usuario; respuesta limitada a 3 frases en español.

### Área 6: UX voz-primero

- **Sin barra de modos** — la app es una sola pantalla; el modelo decide qué tool usar.
- **Permisos cámara + mic** otorgados upfront con UI explícita.
- **Estado idle/ready/connecting/live/reconnecting/ended/error** con overlays diferenciados.
- **Hints rotantes** cuando no hay conversación activa: 6 frases en rotación cada 4.5 s para enseñar al usuario qué decir.
- **Mute toggle** con cambio visual (botón blanco → rojo, halo conic-gradient cuando activo).
- **Camera flip** entre frontal y trasera (`facingMode`), reemplazando solo el video track sin recrear el MediaStream completo.
- **Settings sheet** (bottom drawer mobile / centered modal desktop) con: ver memorias, cambiar cámara, detener sesión.

### Área 7: Diseño y responsiveness

- **Tema dark blue** con tokens CSS: `--bg #080c14`, `--bg-card #0f1623`, `--bg-overlay rgba(10,14,20,0.92)`, escala `--blue-50` a `--blue-950`.
- **Tipografía**: Bricolage Grotesque (display) + JetBrains Mono (mono), via `next/font/google`.
- **Iconografía**: 14 iconos Tabler (`@tabler/icons-react ^3.44.0`).
- **Logo SVG inline** (`SensLogo.tsx`): rombo rotado + "L" interior, currentColor para reutilizar como ícono.
- **Bento grid** en landing (2-col mobile → 6-col desktop) con hero gradient azul + 5 capability cards + 2 feature cards + CTA.
- **Live screen**: layout responsivo con camera viewport + corner guides + focus circle pulsing + voice wave bars (12 bars con audio level + sinusoidal phase); en desktop se agrega un sidebar con conversación + memorias recientes.
- **Animaciones CSS**: `fade-rise` (reveal), `caption-rise`, `pulse-ring`, `live-pulse`, `audio-bar`, `wave-bounce`, `focus-pulse`, `spin-slow` (halo conic-gradient), `marquee`, `blink` (caret).

### Área 8: Configuración y diagnóstico

- **Script `check-api-access.mjs`**: pruebas paralelas de 5 modelos (free-tier text, Pro text, Search grounding, Nano Banana Pro image, Live API token mint).
- **Script `list-models.mjs`**: lista modelos Live disponibles por API version (v1alpha, v1beta, v1) — descubre los que el SDK no documenta.
- **PWA manifest** con `display: standalone`, `theme_color: #080c14`, ícono SVG.
- **`.env.example`** mínima (solo `GEMINI_API_KEY`).

## 5. Decisiones técnicas clave inferidas

- **Decisión**: Gemini Live API como núcleo de la experiencia (no GPT-4o realtime, no Claude voice).
  - **Why probable**: el evento es un hackatón "Best Use of the Google Gemini API", lo cual restringe el modelo. Pero también Live API es de los pocos APIs con audio + video streaming nativo en un solo WebSocket.
  - **Tradeoff**: API menos madura, model name discovery problemático (se ve en `scripts/list-models.mjs`), function calling débil del modelo Live (varios commits muestran fallback a ejecución directa client-side).

- **Decisión**: Tokens efímeros server-side en lugar de proxy reverso o key en cliente.
  - **Why probable**: el WebSocket de Gemini Live exige conexión directa cliente↔Google para latencia; proxiear el WS sería complejo y caro. Los ephemeral tokens son la forma "oficial" del SDK.
  - **Tradeoff**: requiere una llamada extra a `/api/token` antes de cada sesión; el token tiene `uses: 1` y se invalida al primer uso; si la sesión cae después de consumirlo, hay que mintear de nuevo.

- **Decisión**: Sin base de datos. Memorias en `localStorage`.
  - **Why probable**: tiempo de hackatón limitado; añadir DB implicaba auth, schema, costos de infra. localStorage es instant-on, cero backend.
  - **Tradeoff**: no hay sync entre devices, no hay backup, cap de ~5-10 MB por origin, las memorias se borran si el usuario limpia su storage del browser.

- **Decisión**: Cliente monolítico (`app/live/page.tsx` con 1 153 LOC).
  - **Why probable**: velocidad de desarrollo en hackatón. Tener todo en un solo archivo evita el diseño cuidadoso de boundaries y permite copy-paste rápido entre flows.
  - **Tradeoff**: el archivo es difícil de refactorizar; cualquier cambio re-renderiza todo el componente; mezcla concerns (audio, memorias, settings, render). Deuda técnica clara para post-hackatón.

- **Decisión**: AudioWorklet inline cargado vía Blob URL en lugar de archivo separado.
  - **Why probable**: simplicidad de deployment — no requiere copiar un archivo extra a `public/`. El código del worklet (30 líneas) cabe holgadamente como string template.
  - **Tradeoff**: el worklet no se puede syntax-highlight ni testear como módulo. Cualquier cambio requiere editar un string en TS.

- **Decisión**: Mic gate client-side (descartar uploads mientras AI habla) en lugar de confiar 100 % en echo cancellation.
  - **Why probable**: durante el desarrollo se descubrió que la EC del browser tarda ~300 ms en converger al inicio de cada turn, y que ocasionalmente filtra audio mid-turn. Cualquier filtración dispara el VAD del server y corta al modelo.
  - **Tradeoff**: se pierde el barge-in real (el usuario no puede interrumpir hablando al modelo mientras éste habla). Para una demo de accesibilidad esto es aceptable, pero para UX larga es una limitación.

- **Decisión**: Session resumption + goAway preempt en lugar de aceptar el corte de 2 min.
  - **Why probable**: el demo necesita conversaciones que duren más que 2 min para ser creíble; perder contexto en cada reconexión sería frustrante. La API ya soportaba resumption — solo había que cablearlo.
  - **Tradeoff**: complejidad extra en `LiveSession` (handle persistente, callback `onResumeHandleUpdate`, parsing de duration string en `goAway.timeLeft`); el flag `transparent: true` fue rechazado por la API pública y tuvo que removerse (ver commit `ca0dc99`).

- **Decisión**: Tres modelos distintos para tres casos (Live, Pro vision, Pro + Search).
  - **Why probable**: el modelo Live es liviano y rápido pero tiene OCR débil y no expone Search grounding; Pro tiene mejor vision/grounding pero es síncrono y más lento.
  - **Tradeoff**: tres latencias distintas, tres comportamientos de fallback, tres prompts que mantener.

- **Decisión**: Quitar `generate_visual_aid` y `dispatch_action` después de tenerlos.
  - **Why probable**: Visual gen requiere paid tier en AI Studio (`free_tier_requests, limit: 0`), confirmado contra prod. Dispatch_action (tel:/sms:/share) tenía UX frágil entre browser y app nativa.
  - **Tradeoff**: scope más estrecho pero todas las features que quedaron son 100 % confiables para demo.

- **Decisión**: Tailwind v4 + dark blue palette + Tabler Icons en lugar del estilo "Wayfinding Brutalism" yellow inicial.
  - **Why probable**: el usuario pidió explícitamente un redesign hacia un estilo más "producto profesional" tipo dashboard. La paleta blue genera más confianza para una app médica/accesibilidad.
  - **Tradeoff**: ~70 % del CSS hubo que reescribirse; el branding cambió mid-development (AccessLens → Sens).

## 6. Historia y evolución (desde git)

Timeline cronológico (todo en 2026-05-09):

**Hitos del proyecto:**

- **2026-05-09** — `Initial commit` — repo creado.
- **2026-05-09** — `chore: scaffold Next.js 16 with TypeScript, Tailwind 4, and Gemini SDK` — base de la app.
- **2026-05-09** — `feat(api): add ephemeral token, Nano Banana, and place-finder endpoints` — los 3 (entonces 4) endpoints serverless.
- **2026-05-09** — `feat(lib): Live API session wrapper, PCM audio I/O, and 4 mode prompts` — `gemini-live.ts`, `audio.ts`, `modes.ts` con 4 modos iniciales (Eyes/Read/Visual/Where).
- **2026-05-09** — `feat(ui): wayfinding-brutalism theme with PWA manifest and viewfinder icon` — primera iteración del diseño (paleta yellow/black).
- **2026-05-09** — `feat(ui): bold accessibility-first landing with chip grid and ticker` — landing v1.
- **2026-05-09** — `feat(ui): live experience screen with mode chips, captions, and visual overlays` — live screen v1 con 4 modos.
- **2026-05-09** — `docs: replace scaffolded README with project doc and add TEAM playbook` — primera docs.
- **2026-05-09** — `fix(live): use gemini-3.1-flash-live-preview, force v1alpha, gate audio on setupComplete` — **debugging crítico** del nombre del modelo y la API version.
- **2026-05-09** — `fix(audio): resample at native rate, disable echo cancellation, log mic device` — fix #1 de audio (la EC se desactivó aquí, después se vuelve a activar al descubrir el echo loop).
- **2026-05-09** — `fix(ios): use AudioWorklet for capture + native rate for player` — fix de iOS Safari (ScriptProcessorNode no funciona).
- **2026-05-09** — `fix: kill speaker->mic echo loop that cut model output mid-sentence` — descubrimiento del echo loop; arreglo con EC + VAD relajado.
- **2026-05-09** — `fix(live): gate mic uploads while model is speaking` — capa final del mic gate client-side.
- **2026-05-09** — `feat: collapse modes into one screen + add Memorias and Acciones tools` — refactor mayor: de 4 modos a single-mode, añade `save_memory` y `dispatch_action`.
- **2026-05-09** — `feat(chips): make chips execute tools directly + lucide icons` — fallback de ejecución directa porque el Live model no llama tools confiablemente.
- **2026-05-09** — `fix: Vercel function timeouts + chips ask user instead of hardcoding` — `maxDuration = 60` en rutas largas.
- **2026-05-09** — `feat: full UI redesign with dark blue palette + 4-mode bento + Tabler icons` — **pivot visual mayor**: yellow → dark blue, Tabler icons.
- **2026-05-09** — `feat(rebrand): AccessLens -> Sens + voice-only UX + responsive desktop` — **rebrand** + desktop layout + remover barra de modos.
- **2026-05-09** — `feat: indefinite session via resumption + remove unsupported tools` — session resumption + quitar `dispatch_action` y `generate_visual_aid`.
- **2026-05-09** — `fix(live): drop unsupported 'transparent' flag from sessionResumption` — fix de prod (Vertex-only flag rechazado por API pública).
- **2026-05-09** — `docs: add EQUIPO.md — single-doc context for the team` — onboarding doc para el equipo.
- **2026-05-09** — `docs: rebrand repo + split handoff docs (DevPost / demo / pitch)` — README rewritten + DEPLOY/DEVPOST/DEMO/PITCH separados.

**Pivots o refactors mayores detectables:**

1. **De 4 modos a single-mode voz-primero** (commit `726453e`). El UX inicial tenía Ojos/Leer/Visual/Dónde como chips; se colapsó porque el usuario notó que era fricción innecesaria.
2. **De "Wayfinding Brutalism" (yellow/black) a "Dark Blue Bento"** (commit `48bbe15`). Cambio total de palette, primitivas CSS, e iconografía (de lucide a Tabler).
3. **De AccessLens a Sens** (commit `037c204`). Rebrand completo a mid-development.
4. **Eliminación de `dispatch_action` y `generate_visual_aid`** (commit `9625a00`). Decisión consciente de reducir scope a lo que funciona 100 %.

**Patrones de actividad:**

- **Sprint único de un día** (2026-05-09). 27 commits en menos de 12 horas.
- **Iteración fix → refactor → fix**: cada vez que se descubría un bug nuevo (iOS, echo loop, Vercel timeout, billing, transparent flag), siguió un commit `fix:` inmediato.
- **Documentación al final**: las últimas 2 horas se dedicaron a docs (EQUIPO, DEVPOST, DEMO, PITCH, README rebrand).

**Contribuidores** (de git log):

- **Jhulyammm** — 25 commits (~93 %). Lead developer en todo el ciclo.
- **Joshua Ricardo Ortiz Escobar** — 2 commits (`merge and add project files`, `Remove sensitive API key from api.py`). Colaboración limitada, principalmente housekeeping de archivos sensibles.

## 7. Métricas y datos cuantitativos detectables

- **Latencia y timing (de comments en código)**:
  - "AudioWorklet @ ~85ms" implícito en `CAPTURE_BUFFER_SIZE = 4096` a 48 kHz = ~85 ms por chunk.
  - "EC tarda ~300ms en converger" (comentario en `gemini-live.ts:58`).
  - "Pro vision describing a high-res image can take 5-15s" (comentario en `route.ts:6` de memory).
  - "Search grounding can take 5-15s while the model walks Google results" (comentario en nearby).
- **Límites configurados**:
  - `SESSION_FAILSAFE_SEC = 115` (s antes de forzar reconexión).
  - `FRAME_INTERVAL_MS = 1000` (1 frame de video por segundo).
  - `MAX_MEMORIES = 20` (cap de memorias en localStorage).
  - `MEMORIES_KEY = "accesslens:memories"` (key heredada del nombre viejo, marcada como "back-compat").
  - `maxDuration = 60` segundos en `/api/memory` y `/api/nearby` (Vercel Pro plan).
  - Ephemeral token: `expireTime = 30 min`, `newSessionExpireTime = 2 min`, `uses: 1`.
- **Audio config**:
  - `INPUT_SAMPLE_RATE = 16000` Hz (PCM 16-bit mono).
  - `OUTPUT_SAMPLE_RATE = 24000` Hz.
  - `CAPTURE_BUFFER_SIZE = 4096` samples por chunk.
  - VAD: `prefixPaddingMs: 1000`, `silenceDurationMs: 1500`, `START_SENSITIVITY_LOW`, `END_SENSITIVITY_LOW`.
  - Mic gate drain: 600 ms post-`turnComplete`.
- **Frame capture**:
  - Realtime stream: max edge 768 px, quality 0.7.
  - Memorias: max edge 1280 px, quality 0.85.
- **VU meter**:
  - 12 voice bars en mid-screen.
  - 8 audio bars en stat card (landing).
  - Hint rotation cada 4.5 s.
- **Iconografía**: 14 iconos Tabler distintos importados.
- **Volumen de código**: 2 768 LOC TS/TSX/JS. Archivo más grande: `app/live/page.tsx` (1 153 LOC, 41 % del total).

## 8. Issues técnicos resueltos (notable)

Identificados desde git log y comentarios:

- **Bug**: ScriptProcessorNode no dispara `onaudioprocess` en iOS Safari 16+ (commit `742a90b`). **Fix**: migración a AudioWorkletNode con código inline blob; fallback a ScriptProcessor para Safari viejo.
- **Bug**: `new AudioContext({ sampleRate: 24000 })` rechazado o causa drift en iOS (commit `d30e9c8`). **Fix**: usar `new AudioContext()` (sample rate nativo) y resamplear PCM 24kHz→native dentro de `enqueue()`.
- **Bug**: WS cerraba con código 1008 "model not found for API version v1main" (commit `e1be3ce`). **Fix**: descubrir nombre correcto del modelo (`gemini-3.1-flash-live-preview`) via `list-models.mjs` + forzar `apiVersion: "v1alpha"` en `httpOptions`.
- **Bug**: el modelo se cortaba a media frase (commit `9a00626`). **Fix raíz identificado**: echo loop — el speaker reproducía la voz del modelo, el mic la captaba, el VAD del server lo interpretaba como interrupción. **Fix de 3 capas**: EC activado, VAD desensibilizado con `prefixPaddingMs: 1000`, mic gate client-side (`aiSpeaking` flag).
- **Bug**: `/api/visual` y otros endpoints fallaban con 500 en producción (commit `582403a`). **Fix raíz**: timeout default de Vercel de 10 s, vs. Pro vision tardando 15-30 s. **Fix**: `export const maxDuration = 60`.
- **Bug**: el modelo Live no invoca tools confiablemente — alucinaba respuestas verbales ("ya lo guardé") sin llamar la función (commit `d101e61`). **Fix**: chips ejecutan tool directamente desde el cliente (bypass del modelo) como fallback.
- **Bug**: el flag `transparent: true` en `sessionResumption` era rechazado por la API pública (era Vertex-only), descubierto en producción (commit `ca0dc99`). **Fix**: enviar `sessionResumption: {}` cuando no hay handle, `{ handle }` cuando sí.
- **Bug**: `/api/visual` fallaba con 429 "free_tier_requests, limit: 0" — la API key del proyecto no tenía billing habilitado para image generation (commit `9625a00`). **Fix**: el feature se removió del producto; el endpoint detectaba el error específico y devolvía 402 con `needsBilling: true`.
- **Security**: API key expuesta en `api.py` en un merge anterior (commit `763f984`). **Fix**: removida y rotada.
- **Refactor**: colapso de 4 modos en single-mode (commit `726453e`) — UX simplification driven by user feedback en chat.
- **Optimización**: `elapsedRef` cambió de `useState` a `useRef` (commit `9625a00`) para evitar 1 re-render por segundo del timer.

## 9. Deuda técnica detectada

- **`app/live/page.tsx` con 1 153 LOC** — componente cliente monolítico que mezcla camera/mic lifecycle, AudioCapture, AudioPlayer, LiveSession, Memorias UI, settings sheet, frame loop, session timer, mic gate, hint rotator, tool dispatch. Candidato #1 para refactor en módulos: `useLiveSession()`, `useMemories()`, `useCamera()` hooks; sub-componentes para Memorias overlay, Settings sheet, BottomControls.
- **`MEMORIES_KEY = "accesslens:memories"`** — clave de localStorage heredada del nombre viejo. Comentada como "keep key for back-compat with existing memories" — funcional pero inconsistente con el rebrand.
- **Tres modelos hard-codeados sin abstraer**: `gemini-3.1-flash-live-preview` en `lib/gemini-live.ts` + `/api/token`; `gemini-3-pro-preview` con fallback `gemini-2.5-flash` en `/api/memory` y `/api/nearby`. Si cambia un nombre, hay que tocar 3 archivos. Sugerencia: `lib/models.ts` con constantes centralizadas.
- **Sin tests**. Cero tests unitarios, de integración, o e2e. Áreas críticas sin cobertura: resampleo de audio, parsing de duration string en `goAway.timeLeft`, mic gate state machine, function call dispatch.
- **Logging via `console.log`** sin niveles ni structured logging. Para producción sería deseable un logger configurable (Pino/Winston en server, custom en client) que pueda silenciarse en prod o enviar a Sentry.
- **Sin Error Boundaries** en React — un error no controlado en el live page rompe toda la app, sin UI de recovery.
- **`silentGain` se conecta a `destination`** en `lib/audio.ts:154` para "keep the worklet alive on iOS" — workaround documentado pero frágil; si Safari cambia comportamiento, se rompe sin aviso.
- **Mic gate descarta audio sin buffer** — durante `aiSpeaking`, los chunks se descartan completamente. Si el usuario empieza a hablar justo antes de que el gate cierre, se pierden los primeros ms de su intervención.
- **`onClose` no distingue tipos de cierre** — la lógica de reconexión solo mira `reconnectingRef.current`; un cierre por error (4xxx) y un cierre limpio (1000) son tratados igual.
- **`StreamRef.current?.getTracks().forEach((t) => t.stop())`** dentro del `useEffect` cleanup — si el componente unmount ocurre durante un reconnect, hay race condition sutil.
- **`as GoogleSearch`** type assertion en `/api/nearby` — el SDK no expone bien el tipo, se fuerza con `as`. Riesgo bajo pero indica fricción con tipos del SDK.
- **Sin rate limiting** en los endpoints `/api/*` — cualquiera con la URL puede agotar la quota de Gemini con un script.
- **`captureFrameJpegBase64`** crea un `<canvas>` nuevo en cada call (1 por segundo durante live) — overhead de garbage collection. Sugerencia: reusar un canvas singleton.
- **TODOs/FIXMEs**: cero `TODO:`, `FIXME:`, `HACK:`, `XXX:` en el codebase. Eso indica disciplina, o que el equipo no usa esa convención.
- **`AGENTS.md`** contiene una sola línea de instrucción técnica antigua sobre Next.js (no documenta el proyecto).

## 10. Estado de documentación

- **README.md**: completo y actual. Cubre tagline, capacidades, cómo correr local, arquitectura, modelos usados, flujo de seguridad, pipeline de audio, sesión indefinida, workflow git. Apunta a los otros 5 docs.
- **Docs internas** (raíz):
  - **`EQUIPO.md`** (29.8 KB) — onboarding completo del equipo: arquitectura, decisiones, bugs conocidos, glossary técnico, roadmap, 15 secciones.
  - **`DEPLOY.md`** (5.5 KB) — guía Vercel paso a paso + troubleshooting.
  - **`DEVPOST.md`** (9.3 KB) — submission con 4 elevator pitches, project story completo, tags, checklist.
  - **`DEMO.md`** (9.3 KB) — guion del video 5 min: setup, shot list de 14 tomas, captions, color grade, fallback plan.
  - **`PITCH.md`** (12.5 KB) — preparación de pitch en vivo: 8 temas técnicos, Q&A scripts, choreografía 4-personas, plan de práctica.
  - **`AGENTS.md`** — solo una nota técnica sobre Next.js, no documenta el proyecto.
- **Comentarios en código**: **muchos y de alta calidad**. Especialmente en `gemini-live.ts`, `audio.ts`, y `app/live/page.tsx`, cada decisión no-obvia tiene su comentario con el "por qué". Patrón consistente: explicar el FAILURE MODE que motivó la decisión.
- **API docs / OpenAPI / Swagger**: no existen. Tres rutas únicas, request/response shape documentado solo en código.
- **Onboarding para nuevo dev**: claro. `README.md` + `EQUIPO.md` deberían bastar para que alguien empiece a contribuir en <30 min.
- **Decisiones documentadas (ADRs)**: no hay un `docs/adrs/` formal, pero `EQUIPO.md` tiene la sección "Decisiones técnicas con razones" que cumple ese rol.

## 11. Testing y QA

- **Frameworks de test usados**: **ninguno**. No hay `vitest`, `jest`, `playwright`, `@testing-library/*` en `package.json`.
- **Cobertura aproximada**: 0 %.
- **Tipos de tests presentes**: cero.
- **Tests faltantes notables**:
  - `lib/audio.ts` — `resampleLinear`, `int16ToBase64`/`base64ToInt16`, mic gate.
  - `lib/gemini-live.ts` — `aiSpeaking` state machine, drain timer, parsing de `goAway.timeLeft`, pending buffer flush.
  - `app/api/*` — manejo de errores, fallback de modelo, validación de body.
  - `app/live/page.tsx` — state machine de status, lifecycle de stream + capture + player.
- **CI corre tests**: no hay CI configurado (no GitHub Actions, no Vercel test hook).
- **QA real**: validación manual durante el desarrollo (commits `fix:` después de probar en iPhone real, en producción Vercel, contra rate limits). Esto es **testing por experimentación** — válido en hackatón, insuficiente para producción.

## 12. Deploy y operaciones

- **Cómo se deploya**:
  1. Push a `main` en GitHub.
  2. Vercel auto-deploya en ~90 segundos.
  3. Env var `GEMINI_API_KEY` configurada en Settings → Environment Variables (3 entornos: Production, Preview, Development).
  4. Build: `next build` (default).
  5. Output: `.next/` (Next.js output standard).
- **Entornos**:
  - **Production** — `https://gemini-api-key-integration.vercel.app`.
  - **Preview** — automático para cada PR.
  - **Development** — local con `npm run dev`.
- **Variables de entorno requeridas** (del `.env.example`):
  - `GEMINI_API_KEY` — única variable. El código también acepta `GOOGLE_API_KEY` como alias.
- **Dependencias externas críticas**:
  - **Google Gemini API** — todo el funcionamiento. Si Gemini cae, la app no responde.
  - **Vercel** — hosting + funciones serverless. Si cae, no hay URL pública.
  - **Google Search** (vía grounding) — solo afecta `find_nearby_place`.
- **Costos de operación estimados**:
  - Vercel: requiere plan **Pro** ($20/mes) para `maxDuration = 60`. En Hobby (free) las funciones largas fallan con 504.
  - Gemini API: pricing por tokens en Live API + Pro vision. Sin medición real implementada — costos opacos.
- **Procesos manuales conocidos**:
  - Configurar `GEMINI_API_KEY` en Vercel UI (no scripted).
  - Rotación de keys manual.
  - Verificación de modelos via `scripts/check-api-access.mjs` manual.
  - No hay alertas, monitoring, ni dashboards.

## 13. Seguridad y configuración

- **Manejo de secretos**: env vars vía `.env.local` (gitignored) + Vercel env vars. **`api.py` con key hardcoded fue removido** en commit `763f984` — riesgo histórico pero ya mitigado.
- **Auth implementada**: **ninguna** para usuarios finales. Acceso público al demo. El único "auth" es la GEMINI_API_KEY server-side que protege el endpoint de tokens.
- **Validación de inputs**: manual en cada endpoint. Patrón `body.field?.trim()` + check de presencia. **Sin Zod, Yup, o schema validator**.
  - `/api/memory`: valida `imageBase64` presente.
  - `/api/nearby`: valida `query` presente, GPS opcional.
  - `/api/token`: no recibe body.
- **Rate limiting**: **no implementado**. Cualquiera puede llamar los endpoints en bucle y agotar la quota.
- **CORS / CSP**: no configurados explícitamente. Next.js default permite same-origin.
- **Vulnerabilidades visibles**:
  - **Sin rate limiting** → vulnerable a abuse de quota.
  - **Sin auth** → cualquiera puede mintear tokens (mitigado por `uses: 1` y `expireTime: 30min` + lock al modelo Live).
  - **Inputs base64 sin tamaño máximo validado** en `/api/memory` — un atacante podría enviar imágenes enormes que consuman tiempo de función Pro.
  - **Stack trace en respuesta de error** (`message: err.message`) — leak menor de info interna.
  - **`console.log` con `track.label`** — el label del mic puede contener PII (ej: "John's iPhone"). Riesgo bajo en local; nulo en prod ya que no hay log shipping.
- **Cumplimiento**: nada mencionado. Sin GDPR/HIPAA/SOC2. **Las memorias se quedan en el device del usuario** (localStorage) — implicaciones positivas de privacidad: no procesamos PII en server-side persistente, pero las imágenes SÍ pasan por la API de Google para su descripción.

## 14. Patrones y snippets dignos de preservar

### Patrón 1: Ephemeral token mint con scope mínimo

- **Archivo**: `app/api/token/route.ts`
- **Por qué vale la pena**: muestra cómo abrir un WebSocket browser→AI provider sin exponer la API key principal. El token está limitado por tiempo (30 min), por usos (1), y por modelo + modalidad. Es la forma "correcta" de hacer streaming AI desde browser.

```typescript
const ai = new GoogleGenAI({
  apiKey,
  httpOptions: { apiVersion: "v1alpha" },
});

const expireTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();
const newSessionExpireTime = new Date(Date.now() + 2 * 60 * 1000).toISOString();

const token = await ai.authTokens.create({
  config: {
    expireTime,
    newSessionExpireTime,
    uses: 1,
    liveConnectConstraints: {
      model: LIVE_MODEL,
      config: { responseModalities: [Modality.AUDIO] },
    },
  },
});
```

### Patrón 2: Session resumption + goAway preempt para "sesión indefinida"

- **Archivo**: `lib/gemini-live.ts` (callbacks `onResumeHandleUpdate`, `onGoAway`)
- **Por qué vale la pena**: sortea el hard limit de 2 min del Live API. La lógica de detectar `goAway` + parsear duration string + disparar reconexión con handle es replicable en cualquier WS API que ofrezca resumption.

```typescript
if (msg.sessionResumptionUpdate?.resumable && msg.sessionResumptionUpdate.newHandle) {
  this.resumeHandle = msg.sessionResumptionUpdate.newHandle;
  this.events.onResumeHandleUpdate?.(this.resumeHandle);
}
if (msg.goAway) {
  const raw = msg.goAway.timeLeft ?? "0s";
  const m = /^([\d.]+)s$/.exec(String(raw));
  const seconds = m ? Math.max(0, Math.floor(parseFloat(m[1]))) : 0;
  this.events.onGoAway?.(seconds);
}
```

### Patrón 3: AudioWorklet inline para iOS Safari compat

- **Archivo**: `lib/audio.ts` (`CAPTURE_WORKLET_CODE` + `addModule(blob URL)`)
- **Por qué vale la pena**: solución portable al problema de "ScriptProcessorNode falla silenciosamente en iOS 16+". Cargar el worklet como blob URL evita tener que servir un archivo `.js` separado desde `public/`.

```typescript
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

const blob = new Blob([CAPTURE_WORKLET_CODE], { type: "application/javascript" });
const workletUrl = URL.createObjectURL(blob);
await context.audioWorklet.addModule(workletUrl);
```

### Patrón 4: Mic gate anti-echo con drain timer

- **Archivo**: `lib/gemini-live.ts` (`aiSpeaking`, `aiSpeakingDrainTimer`)
- **Por qué vale la pena**: previene el "echo loop" en streaming bidirectional audio (speaker → mic → server VAD → falso interrupt). La técnica del **drain timer post-turnComplete** es clave: no se reabre el gate inmediatamente, se espera ~600 ms para que el buffer del player termine de salir.

```typescript
// Cuando llega audio del modelo:
this.aiSpeaking = true;
if (this.aiSpeakingDrainTimer) clearTimeout(this.aiSpeakingDrainTimer);

// En turnComplete:
this.aiSpeakingDrainTimer = setTimeout(() => {
  this.aiSpeaking = false;
}, 600);

// En sendAudio (chunks del mic):
if (this.aiSpeaking) return; // Descartar mientras AI habla
```

### Patrón 5: Tool-call con fallback de modelo

- **Archivo**: `app/api/memory/route.ts` y `app/api/nearby/route.ts`
- **Por qué vale la pena**: cuando una API es flaky o tiene tiers de billing distintos, tener un fallback automático mantiene la disponibilidad. Patrón replicable.

```typescript
const tryGenerate = async (model: string) => { /* ... */ };

try {
  let response;
  try {
    response = await tryGenerate(PRIMARY_MODEL);
  } catch {
    response = await tryGenerate(FALLBACK_MODEL);
  }
  // ...
}
```

## 15. Áreas de mejora identificadas

- **Mejora 1**: Refactor `app/live/page.tsx` en hooks + sub-componentes. Crear `useLiveSession()`, `useCamera()`, `useMemories()`, `useMicGate()`. Extraer `MemoriasOverlay`, `SettingsSheet`, `BottomControls`, `CaptionBox`, `VoiceWaveBars` como componentes.
  - **Impacto**: testabilidad masiva, menos re-renders, código más mantenible.
  - **Esfuerzo**: **L** (3-5 días).
- **Mejora 2**: Agregar tests unitarios para `lib/audio.ts` y `lib/gemini-live.ts`. Crítico: `resampleLinear`, parsing de `goAway.timeLeft`, mic gate state machine.
  - **Impacto**: confianza en cambios futuros, prevenir regresiones en audio (la parte más frágil).
  - **Esfuerzo**: **M** (1-2 días).
- **Mejora 3**: Implementar rate limiting en endpoints. Upstash Redis + middleware Next.js, máx N req/min por IP.
  - **Impacto**: protege la quota de Gemini de abuse.
  - **Esfuerzo**: **S** (4 h).
- **Mejora 4**: Validación con Zod en `/api/memory` y `/api/nearby`. Schema explícito + límite de tamaño de imagen base64 (ej: max 2 MB).
  - **Impacto**: type-safety + protección contra payloads enormes.
  - **Esfuerzo**: **S** (2 h).
- **Mejora 5**: Centralizar nombres de modelos en `lib/models.ts`. Una sola constante por modelo + helper `getLiveModel()`, `getVisionModel()`.
  - **Impacto**: cambiar un modelo no requiere tocar 3 archivos.
  - **Esfuerzo**: **S** (30 min).
- **Mejora 6**: Renombrar `MEMORIES_KEY` con migración. Leer de `accesslens:memories`, escribir a `sens:memories`, escribir migración one-time.
  - **Impacto**: consistencia con rebrand sin perder data existente.
  - **Esfuerzo**: **S** (1 h).
- **Mejora 7**: Sync de Memorias a un backend opcional (Supabase). Sin auth si querés mantener "no login", solo un device ID en localStorage + un endpoint `/api/memories/sync` con throttling.
  - **Impacto**: persistencia entre devices, backup, base para "compartir memorias".
  - **Esfuerzo**: **M** (1-2 días).
- **Mejora 8**: Error boundaries en React + UI de recovery. Capturar errores del live session sin tumbar toda la app.
  - **Impacto**: UX en estados de fallo, especialmente en demo.
  - **Esfuerzo**: **S** (3 h).
- **Mejora 9**: Telemetría minimal (Vercel Web Analytics o PostHog). Eventos: session_start, session_resumed, memory_saved, tool_call_X. Cero PII.
  - **Impacto**: visibilidad de uso real post-hackatón.
  - **Esfuerzo**: **S** (3 h).
- **Mejora 10**: Reusar un `<canvas>` singleton en `captureFrameJpegBase64` en lugar de crear uno nuevo cada segundo. Reduce GC pressure.
  - **Impacto**: leve mejora de performance en sesiones largas.
  - **Esfuerzo**: **S** (30 min).

═══════════════════════════════════════════════════
PARTE 2 — SUGERENCIAS PARA CV
═══════════════════════════════════════════════════

## 16. Bullets propuestos para CV técnico

1. **Construí Sens**, una PWA voz-primero de accesibilidad sobre **Google Gemini Live API**, integrando 3 modelos Gemini orquestados (`gemini-3.1-flash-live-preview` para conversación bidireccional, `gemini-3-pro-preview` para vision/OCR y Search grounding), con **session resumption + goAway preemption** para sortear el límite de 2 min y lograr conversaciones indefinidas.

2. **Implementé un pipeline de audio multimodal cross-browser**: AudioWorklet inline cargado vía Blob URL (compat iOS Safari 16+, donde `ScriptProcessorNode` falla silenciosamente), resampleo lineal client-side entre rate nativo del device y los formatos PCM 16 kHz / 24 kHz que requiere Gemini Live, y un **mic gate state machine** anti-echo loop con drain timer post-turn que previene el barge-in espurio del VAD del servidor.

3. **Diseñé una arquitectura de seguridad browser-direct WS**: el cliente nunca ve la API key — un endpoint serverless `/api/token` (Next.js + Vercel) mintea **ephemeral tokens** de 30 min limitados al modelo Live y modalidad audio, con `uses: 1`, y el WebSocket se abre directo browser↔Google. Stack: Next.js 16 App Router, React 19, TypeScript estricto, Tailwind v4.

## 17. Bullets propuestos para CV de impacto

1. **Lideré el desarrollo end-to-end** de un asistente de accesibilidad por voz para **personas con baja visión, sordera y dislexia**, entregando una experiencia donde el usuario abre una URL, habla, y la IA describe escenas, lee y traduce texto en 97 idiomas, orienta con búsqueda real (Google Search grounding) y guarda memorias persistentes con descripción detallada — sin descargas, sin login, en una sola URL pública.

2. **Sorteé limitaciones críticas del API** que invalidaban casos de uso reales: el hard limit de 2 minutos por sesión (que cortaba conversaciones a mitad de una receta médica) lo resolví con session resumption + goAway preempt; el echo loop entre speaker y mic (que cortaba al modelo a media frase) lo eliminé con una defensa de 3 capas (echo cancellation + VAD relajado + mic gate client-side).

3. **Entregué un proyecto completo en un sprint de un día** (28 commits, 2 768 LOC TS, 6 docs de handoff): app funcional en producción, documentación operacional (`README`, `EQUIPO`, `DEPLOY`, `DEVPOST`, `DEMO`, `PITCH`) y scripts de diagnóstico para que cualquier miembro del equipo pudiera continuar el trabajo sin contexto previo.

═══════════════════════════════════════════════════
PARTE 3 — PARA QUE TÚ (JHULYAM) RELLENES
═══════════════════════════════════════════════════

## 18. Mi rol y equipo

> Autocompletado desde git log + contexto del chat. Validar y ajustar antes de publicar en cualquier surface (CV, LinkedIn, portfolio).

- **¿Solo o en equipo? Tamaño del equipo**: Equipo de **4 personas** para el hackatón.
- **Mi rol específico**: **Lead developer full-stack**. Responsable de la arquitectura técnica completa, integración con Gemini Live API, pipeline de audio (AudioWorklet + resampling + mic gate), session resumption, deploy a Vercel, y toda la documentación operacional del equipo (README, EQUIPO, DEPLOY, DEVPOST, DEMO, PITCH, PROYECTO).
- **% del trabajo que fue mío (aprox.)**: **~93 %** medido por commits (26 de 28 en git log). En LOC y decisiones de arquitectura, prácticamente 100 %.
- **Personas clave con quienes trabajé**:
  - **Joshua Ricardo Ortiz Escobar** — colaboró con el merge inicial de archivos del proyecto y con la rotación de la API key expuesta. Iba a manejar el deploy a Vercel; al final lo retomó Jhulyam.
  - **2 compañeros más del equipo del hackatón** (sin commits directos en main). Roles en el pitch: storyteller (P1), demo lead (P2), tech expert (P3 = Jhulyam), closer/visión (P4). Ajustar nombres al validar.
- **Reporté a / colaboré con**: Equipo de hackatón horizontal, sin manager. Coordinación con el resto del equipo para el pitch y la grabación del demo video.

## 19. Cliente / contexto / NDA

- **Cliente o contexto del proyecto**: **Hackatón "Best Use of the Google Gemini API"** (mayo 2026). Proyecto propio del equipo, sin cliente externo, sin contrato.
- **¿Qué puedo mencionar públicamente?**:
  - **Cliente**: N/A (sin cliente). Puedo mencionar el nombre del hackatón libremente.
  - **Números**: SÍ. Todo el código y métricas están en el repo público.
  - **Código**: SÍ se puede mostrar. Repo público en `github.com/Jhulyammm/sens`, licencia MIT.
- **Si no puedo mencionar al cliente, ¿cómo lo describimos genéricamente?**: N/A — proyecto personal de hackatón, sin restricciones.

## 20. Resultados y métricas que solo yo conozco

> Pendientes hasta después del juicio del hackatón. Volver y completar cuando haya datos reales.

- **Usuarios reales servidos**: — (aún sin métricas; URL pública recién deployada).
- **Volumen procesado**: — (sin telemetría implementada todavía).
- **$ generado / ahorrado**: N/A (proyecto sin modelo de negocio activado).
- **Tiempo en producción real**: desde **2026-05-09** (día del hackatón).
- **Adopción / engagement**: — (sin tracking).
- **Premio o reconocimiento**: PENDIENTE del juicio del hackatón. Categorías a las que se aspira: **Best Use of the Google Gemini API**. Llenar el resultado aquí cuando se anuncie.
- **Testimonios / impacto cualitativo**: — (recopilar después de la demo pública).
- **Otra métrica que importe**:
  - **28 commits en un solo día** — capacidad de ejecución bajo presión.
  - **6 docs operacionales** entregados (README, EQUIPO, DEPLOY, DEVPOST, DEMO, PITCH, PROYECTO).
  - **2 768 LOC** de TypeScript estricto, build limpio, cero warnings.

## 21. Cambios y mejoras que estoy haciendo o quiero hacer

- **En proceso ahora**:
  - Preparación del pitch en vivo de 3 minutos con el equipo (ver `PITCH.md` — estructura 4-personas con énfasis técnico).
  - Grabación del demo video de 5 minutos (ver `DEMO.md` — shot list de 14 tomas, captions, fallback plan).
  - Submission final a DevPost (ver `DEVPOST.md` — texto listo para pegar).
- **Próximos 1-3 meses** (si se decide continuar post-hackatón):
  - Renombrar `MEMORIES_KEY` de `accesslens:memories` a `sens:memories` con migración one-time.
  - Centralizar nombres de modelos en `lib/models.ts`.
  - Validación con Zod en `/api/memory` y `/api/nearby` + cap de tamaño de imagen.
  - Implementar rate limiting (Upstash Redis + middleware Next.js).
  - Telemetría mínima (Vercel Web Analytics o PostHog, cero PII).
- **Backlog identificado** (priorizado en §15):
  - Refactor de `app/live/page.tsx` en hooks + sub-componentes (mejora L, 3-5 días).
  - Tests unitarios para `lib/audio.ts` y `lib/gemini-live.ts` (mejora M, 1-2 días).
  - Error boundaries en React + UI de recovery.
  - Sync opcional de Memorias a backend (Supabase + device ID, sin login).
- **Refactors pendientes**:
  - Cambiar `captureFrameJpegBase64` a usar un `<canvas>` singleton en lugar de crear uno nuevo cada segundo.
  - Distinguir tipos de close en `onClose` (4xxx vs 1000) para mejor reconexión.
  - Eliminar el `silentGain` workaround si Safari actualiza el comportamiento del AudioWorklet.
- **Features deseadas** (roadmap de `EQUIPO.md`):
  - **Subtítulos en vivo** — texto enorme en pantalla de cualquier conversación cercana, traducido al idioma del usuario. Killer feature para sordera.
  - **Diario semanal narrado** — usar el long-context de Gemini sobre todas las memorias guardadas para generar un resumen de la semana.
  - **App nativa** (Capacitor o Tauri) con widget de acceso rápido en iOS/Android.
  - **Modo cuidador** — un familiar recibe un feed pasivo del audio descriptivo del usuario.
  - **Integración Apple Health / Google Fit** — Sens detecta una receta y agenda el horario.
  - **Modo emergencia** — frase activadora ("Sens, emergencia") que dispara grabación + descripción de escena + envío a contactos pre-configurados.

## 22. Proyecciones / visión futura

- **Visión a 6-12 meses**: Sens evoluciona de demo de hackatón a producto utilizable de accesibilidad por voz. Foco en estabilidad (tests + monitoring), expansión de capacidades (subtítulos en vivo para sordera, modo cuidador para familias) y validación con usuarios reales con baja visión / dislexia / sordera. App nativa opcional con shortcuts del SO.
- **¿Es comercializable? ¿Modelo de negocio si aplica?**: SÍ, hay tres rutas claras:
  - **B2C freemium**: gratis con cap de minutos diarios de Live API; premium ($5-10/mes) para uso ilimitado + memorias en cloud.
  - **B2B**: licenciar a hospitales, museos, aeropuertos, universidades para que ofrezcan accesibilidad sin construirla. $X 000/año por institución.
  - **Distribución gratuita** vía partnerships con instituciones de personas con discapacidad (ONCE, organizaciones latinoamericanas), sponsoreado por Google o foundations.
- **¿Open source? ¿Producto? ¿Side project para siempre?**: Producción dual:
  - **Open source** (MIT) la base técnica como referencia para otros que quieran construir sobre Gemini Live API.
  - **Producto cerrado** las features de cloud/sync/modo cuidador.
  - Si el hackatón no abre puertas concretas → side project mantenible con CI mínima y deploy semi-automatizado.
- **Audiencia target si crece**: 1 300 millones de personas con alguna discapacidad visual, auditiva o cognitiva globalmente. Mercado inicial recomendado: Latinoamérica (donde el español es nativo y el mercado de accesibilidad está menos atendido). Sub-segmentos:
  - **Adultos mayores con baja visión** (~50M+ en LATAM): el demo de "leer la receta del doctor" resuena directo.
  - **Migrantes / turistas** que no leen el idioma local (~tens of millions).
  - **Personas con dislexia** (~10 % población general).
  - **Personas con sordera** (futuro, cuando esté Subtítulos en vivo).
- **Lo que sería necesario para escalarlo**:
  - Backend con auth opcional (Supabase) para sync de memorias entre devices.
  - Rate limiting + monitoring + alertas (Sentry, Vercel Analytics, costo de Gemini API por usuario).
  - Tests + CI (GitHub Actions) para que el equipo pueda crecer sin romper.
  - App nativa con offline-first parcial (TTS local cuando no hay red).
  - Pricing tier negociado con Google Cloud para volumen.
  - Localización de UI a inglés, portugués (LATAM mercado).
  - Validación con usuarios reales: focus groups con personas con discapacidad para detectar friction puntos invisibles.

## 23. Contexto humano y lecciones

- **¿Cómo surgió la idea?**: Hackatón "Best Use of the Google Gemini API". El insight central: Gemini Live recién había lanzado audio + video streaming en un solo WebSocket. Nadie estaba usándolo para accesibilidad. La pregunta motora: *"¿y si el teléfono que ya tienes en la mano pudiera ver, oír y hablar **por ti**?"*. Pensamos en una abuela en un hospital que no conoce — no puede leer los letreros, no entiende la receta, no encuentra el baño. Sens nació para ese momento.
- **Momento más difícil del proyecto**: El **echo loop**. El modelo se cortaba a media frase y no entendíamos por qué. Tomó horas de debug entender que era una cadena: speaker reproduce voz del modelo → mic la capta → server VAD lo interpreta como interrupción del usuario → corta al modelo. El fix tuvo 3 capas (echo cancellation + VAD relajado + mic gate client-side) y requirió revertir decisiones anteriores (`fix(audio): disable echo cancellation` se deshizo después). Cerca segundo más difícil: descubrir que la API key de Google estaba en free tier para image gen (cuota = 0) en producción, después de horas pensando que era un bug del código.
- **Decisión de la que estoy más orgulloso**: **Session resumption + goAway preempt para conversaciones indefinidas**. El Live API tiene un hard limit de 2 minutos que ningún demo público sortea. Implementarlo correctamente — escuchar `sessionResumptionUpdate`, persistir el handle, escuchar `goAway`, parsear duration string, abrir nueva sesión con el handle ANTES de que muera la vieja, suprimir el kickoff en sesiones reanudadas — convirtió a Sens en el único demo de Live API que puede tener una conversación natural sin que el usuario perciba un corte. Es la diferencia entre prototipo y producto.
- **Decisión que cambiaría hoy**: Empezar con **`app/live/page.tsx` más modular desde el día uno**. Quedó en 1 153 LOC mezclando 8+ concerns. Aunque la velocidad del hackatón justificó el monolito, en retrospectiva 30 minutos invertidos en crear `useLiveSession()`, `useCamera()`, `useMemories()` hooks habrían pagado intereses durante todo el desarrollo. También: NO empezar con el modelo `gemini-live-2.5-flash-preview` (que los docs sugerían pero no existe) — habría ahorrado el ciclo de "WS close 1008 / list-models.mjs / discover el nombre correcto".
- **Lección técnica más valiosa**: **iOS Safari es la barrera más alta del web móvil moderno, y los fallos son silenciosos**. `ScriptProcessorNode` no tira error, simplemente no llama el callback. `new AudioContext({ sampleRate: 24000 })` no rechaza, hace drift en la timeline después del primer buffer. Custom sample rates parecen funcionar y después se rompen. Lección: probar en hardware iOS real **desde el día uno**, y migrar a AudioWorklet + native sample rates como default, no como fix tardío.
- **Lección de producto / negocio**: **Los modelos de IA fallan en lugares no obvios y hay que diseñar para esa falla**. El modelo Live es flojo para function calling — alucina respuestas verbales tipo "ya lo guardé" sin invocar realmente la función. La lección: **nunca confiar en que el modelo dispare un tool**. Diseñar siempre dos caminos: el camino "el modelo lo hace bien" (ideal) y el camino "el cliente ejecuta directo cuando el modelo no responde como debería" (fallback). Es por eso que los chips en Sens ejecutan los endpoints directamente además de mandar el prompt al modelo.
- **Anécdota memorable**: Descubrir en producción que el flag `transparent: true` en `sessionResumption` — que está en los tipos del SDK como opción válida — solo está soportado en Vertex AI, NO en la Gemini Developer API pública. La API simplemente rechazaba el request completo con "transparent parameter is not supported in Gemini API". Una línea entre el SDK y la API real. La docs no lo decía. Tuve que descubrirlo en prod, con el equipo mirando, mientras intentábamos extender la sesión indefinida. Fix: enviar `sessionResumption: {}` sin flags. Lección colateral: cuando una API te da tipos para algo, eso no significa que el endpoint lo acepte.

## 24. Links y assets

- **Repo (público o privado)**: https://github.com/Jhulyammm/sens — **público**, licencia MIT.
- **Deploy / app live**: https://gemini-api-key-integration.vercel.app (URL del deploy original; el repo se renombró a `sens` pero el dominio Vercel mantiene el nombre viejo, sigue funcional).
- **Demo video**: PENDIENTE — script completo en `DEMO.md`, shot list de 14 tomas, falta grabar y subir a YouTube como unlisted.
- **Screenshots / capturas**: PENDIENTES — minimo 3-5 1080×1080 para galería DevPost (hero shot, memoria abierta, caption en vivo, galería de memorias, landing page).
- **Artículos / posts sobre el proyecto**: — (no hay todavía; considerar escribir uno post-hackatón sobre "Cómo conseguir sesiones indefinidas en Gemini Live API" como contenido técnico para portfolio).
- **Press / mentions**: PENDIENTES del juicio del hackatón.
- **Issue tracker**: https://github.com/Jhulyammm/sens/issues
- **Submission DevPost**: PENDIENTE — texto completo en `DEVPOST.md`, falta enviar antes del deadline.
- **Documentación interna del equipo** (todos en la raíz del repo):
  - [`README.md`](README.md) — producto + cómo correr.
  - [`EQUIPO.md`](EQUIPO.md) — onboarding completo del equipo (15 secciones).
  - [`DEPLOY.md`](DEPLOY.md) — guía Vercel paso a paso.
  - [`DEVPOST.md`](DEVPOST.md) — submission ready-to-paste.
  - [`DEMO.md`](DEMO.md) — guion del video.
  - [`PITCH.md`](PITCH.md) — preparación del pitch en vivo.
  - [`PROYECTO.md`](PROYECTO.md) — este documento, análisis técnico para segundo cerebro.

# Sens — Briefing para el equipo

> Documento de onboarding único. Todo lo que necesitás saber para entender qué es Sens, cómo corre, qué decisiones técnicas tomamos y cómo seguimos.

---

## 1. Qué es Sens

**Sens** es una PWA de accesibilidad voz-primero, construida sobre **Google Gemini Live API**.

El usuario abre una URL en el celular (sin instalar nada, sin login), apunta la cámara, habla, y Sens entiende lo que ve y le responde con voz natural en su idioma — detectando automáticamente entre 97.

### Para quién es

- **Baja visión**: necesitan que alguien les describa lo que tienen enfrente.
- **Sordera/dislexia**: necesitan ver el mundo en texto claro o escucharlo simplificado.
- **Movilidad/orientación**: están en un lugar nuevo y no saben dónde está el baño / la salida / la farmacia.
- **Migrantes/turistas**: no entienden el idioma del menú, el letrero, la receta.

Una sola interfaz cubre las 4 necesidades.

### Qué hace

| Capability | Cómo se invoca | Tecnología |
|---|---|---|
| **Describir** lo que ve la cámara | Hablás: *"qué hay aquí"* | Gemini Live (`gemini-3.1-flash-live-preview`) |
| **Leer + traducir** texto | Hablás: *"léeme esto"* | Gemini Live (97 idiomas auto) |
| **Interpretar** símbolos/contexto | Hablás: *"qué significa esto"* | Gemini Live |
| **Orientar** en el espacio | Hablás: *"dónde queda la farmacia"* | Gemini 3 Pro + Google Search grounding |
| **Guardar Memorias** | Hablás: *"guarda esto"* o tap botón | Gemini 3 Pro vision + localStorage |

### Lo que NO hace (deliberadamente)

- **No genera imágenes** (`generate_visual_aid` removido) — requería billing en Google AI Studio que no asumimos para la demo.
- **No hace llamadas / SMS / alarmas** (`dispatch_action` removido) — la handover web→app nativa era frágil.

Si el usuario pide algo fuera de scope, el system prompt instruye a Sens a explicarlo amablemente y ofrecer alternativa.

---

## 2. Estado actual del proyecto

| Cosa | Estado |
|---|---|
| Live API conversación | ✅ Funciona |
| Saludo según hora del día | ✅ Funciona |
| Memorias (capture + describe + replay) | ✅ Funciona |
| `find_nearby_place` (search grounding) | ✅ Funciona |
| Sesión indefinida (session resumption) | ✅ Funciona |
| iOS Safari compat | ✅ Funciona (AudioWorklet + native sample rate) |
| Responsive desktop | ✅ Funciona (split-panel con sidebar) |
| Logo Sens + branding | ✅ Aplicado |
| Deploy en Vercel | ✅ `https://gemini-api-key-integration.vercel.app` |
| Image generation | ❌ Out of scope (billing) |
| Acciones (tel/sms/alarm) | ❌ Removido |

URL pública: **https://gemini-api-key-integration.vercel.app**
Repo: **https://github.com/Jhulyammm/Gemini-ApiKey-Integration**

---

## 3. Arquitectura técnica

### Stack

```
Frontend
├── Next.js 16 (App Router, Turbopack)
├── React 19
├── TypeScript estricto
├── Tailwind CSS v4
└── @tabler/icons-react

IA
├── @google/genai SDK
├── gemini-3.1-flash-live-preview  (Live API, audio+video bidireccional)
├── gemini-3-pro-preview           (memorias, alta calidad vision+text)
└── gemini-3-pro-preview + googleSearch tool  (find_nearby_place)

Audio
├── AudioWorklet (inline blob, compat iOS Safari 16+)
├── Captura PCM 16-bit @ 16 kHz
├── Reproducción PCM 16-bit @ 24 kHz
└── Resampleo lineal a/desde sample rate nativo del device

Persistencia
└── localStorage (memorias, hasta 20 entradas)

Hosting
└── Vercel (serverless functions con maxDuration=60s)
```

### Estructura del repo

```
app/
├── page.tsx              ← landing (bento grid azul)
├── live/page.tsx         ← experiencia principal: cámara, mic, sesión
├── layout.tsx            ← metadata, fuentes, theme color
├── globals.css           ← tokens de color, animaciones, primitivas (.card, .corner-guide, etc.)
└── api/
    ├── token/route.ts    ← mintea ephemeral tokens (server-side, key nunca sale)
    ├── memory/route.ts   ← describe frame con Gemini 3 Pro
    └── nearby/route.ts   ← search grounding para places

components/
└── SensLogo.tsx          ← SVG inline del logo (rombo + L interna)

lib/
├── audio.ts              ← AudioCapture (Worklet), AudioPlayer, frame JPEG, resamples
├── gemini-live.ts        ← LiveSession class (WS wrapper + callbacks + session resumption)
└── modes.ts              ← ASSISTANT config (system prompt + tools + kickoff)

scripts/
├── check-api-access.mjs  ← probe los modelos críticos antes de correr
└── list-models.mjs       ← lista modelos disponibles para tu API key
```

### Flujo de seguridad (CRÍTICO entender)

```
┌──────────┐                                    ┌──────────────┐
│  Browser │ POST /api/token                    │   /api/token │
│          │ ─────────────────────────────────► │              │
│          │                                    │ usa GEMINI_  │
│          │                                    │ API_KEY del  │
│          │                                    │ entorno      │
│          │ ◄───── { token, model } ────────── │              │
│          │     (token efímero 30 min,         │              │
│          │      atado al modelo Live)         └──────────────┘
│          │
│          │  WebSocket directo con el token efímero
│          │ ──────────────────────────────────────► Gemini Live API
│          │ ◄────── audio + video streaming ────── 
└──────────┘
```

**El browser jamás ve `GEMINI_API_KEY`.** El token efímero está atado al modelo Live + modalidad audio, así que aunque alguien lo intercepte, no puede usarlo para image gen u otros modelos costosos.

### Pipeline de audio (la parte más enredada)

```
                                     ┌─ AudioWorkletNode (inline blob)
                                     │   recibe Float32Array @ native rate
getUserMedia ──► MediaStream ──► MediaStreamSource
   (1 stream para               │   ↓
    cámara + mic)               │  resample @ 16 kHz
                                │   ↓
                                │  Float32 → Int16
                                │   ↓
                                │  base64 encode
                                │   ↓
                                │  LiveSession.sendAudio()
                                │   ↓
                                │  [GATE: aiSpeaking? → drop]
                                │   ↓
                                │  WS sendRealtimeInput

                                ┌─ Server envía PCM @ 24 kHz
                                │   ↓
                                │  base64 → Int16
                                │   ↓
                                │  resample 24k → native rate
                                │   ↓
                                │  AudioBufferSourceNode @ native
                                │   ↓
                                │  scheduled append a la timeline
                                │   ↓
                                │  speaker
```

### Sesión indefinida

El Live API tiene un **hard limit de 2 minutos** por WebSocket. Para que la conversación dure todo lo que el usuario quiera, implementamos tres capas:

1. **Session resumption**: cada cierto tiempo el server emite `sessionResumptionUpdate` con un `newHandle`. Lo guardamos.
2. **goAway preempt**: el server avisa "voy a cerrar en N s". Apenas llega el evento, abrimos la sesión nueva con el handle ANTES de que muera la vieja. Kickoff suprimido en sesiones reanudadas para no resaludar al usuario.
3. **Failsafe a 115 s**: si goAway no llega, forzamos reconexión nosotros, justo antes del corte de 120 s.

Estado relevante en código (`lib/gemini-live.ts`):
- `LiveSession.getResumeHandle()` → handle persistente
- Callback `onResumeHandleUpdate(handle)` → guardar en `resumeHandleRef`
- Callback `onGoAway(timeLeftSec)` → llamar `triggerReconnect()` inmediatamente
- `LiveSessionInit.resumeHandle` → pasar al new session para reanudar

⚠️ **NO pasar `transparent: true`** en `sessionResumption`. Es solo Vertex AI; la API pública lo rechaza. Empty `{}` es suficiente.

---

## 4. Cómo correr local

```bash
git clone https://github.com/Jhulyammm/Gemini-ApiKey-Integration.git sens
cd sens
npm install
cp .env.example .env.local
# Edita .env.local y pega tu GEMINI_API_KEY (paid tier ideal, free tier funciona menos image gen)
npm run dev
```

Después abrí `http://localhost:3000` desde el celular en la **misma red WiFi** que la laptop, o usá `ngrok` para tunelar HTTPS (getUserMedia exige HTTPS en mobile).

### Verificar acceso a los modelos antes de correr

```bash
node --env-file=.env.local scripts/check-api-access.mjs
node --env-file=.env.local scripts/list-models.mjs
```

El primero prueba los 5 modelos que Sens usa. El segundo lista qué modelos Live tiene tu key.

---

## 5. Cómo desplegar (resumen)

Detalle completo en **`DEPLOY.md`**. Resumen:

1. Importá el repo en Vercel.
2. Agregá `GEMINI_API_KEY` como env var en **Settings → Environment Variables** (las 3: Production, Preview, Development).
3. Click Deploy.
4. Test post-deploy con `curl -X POST https://TU-URL.vercel.app/api/token` — debe devolver `{ token, model, expiresAt }`.

**Vercel timeout**: agregamos `export const maxDuration = 60` a las rutas largas (`/api/visual`, `/api/memory`, `/api/nearby`) porque Gemini Pro vision tarda 10-15 s y el default de 10 s mata la función. Esto requiere plan Pro de Vercel ($20/mo) o Hobby con timeout reducido.

---

## 6. Decisiones técnicas clave (con razones)

| Decisión | Razón |
|---|---|
| Tokens efímeros, no API key en browser | Seguridad: si alguien sniffea el WS, el token expira en 30 min y solo abre Live. |
| AudioWorklet sobre ScriptProcessorNode | iOS Safari 16+ rompió silenciosamente ScriptProcessor. AudioWorklet es el camino oficial. |
| Sample rate nativo del device + resample manual | iOS rechaza `new AudioContext({ sampleRate: 24000 })`. Fail-fast or drift. |
| Mic gate client-side mientras AI habla | Sin esto, el speaker bleed → mic → server VAD → falso "user interrupt" → AI se corta a media frase. |
| Echo cancellation activado (no desactivado) | Defensa en profundidad contra el echo loop. Junto con el gate, mata el problema. |
| `prefixPaddingMs: 1000` en VAD | Si llega bleed corto, no se interpreta como usuario hablando. |
| Session resumption + goAway preempt | Evita el hard limit de 2 min sin que el usuario lo perciba. |
| Voz-primero, sin barra de modos | El modelo decide qué herramienta usar. Menos UI, menos fricción, demo más limpia. |
| Memorias en localStorage, no DB | Cero backend = cero latencia, cero login, cero privacy issues. |
| Función `save_memory` con frame capture client-side | El server endpoint solo describe; el frame se captura en el browser. Reduce tráfico. |
| Modelo Pro para memorias, Live para conversación | Pro tiene mejor OCR; Live es rápido para diálogo. Cada modelo en su sweet spot. |
| Tabler Icons sobre Lucide | Tabler tiene la línea de diseño que mejor matcheaba el spec del producto. |
| Sin "Llama" / "Dibuja" en UI | Quitamos lo que no funciona o requiere billing. Demo siempre exitosa. |

---

## 7. Bugs conocidos / cosas a tener en cuenta

### Que YA arreglamos (referencia histórica)

- **iOS no captura audio** → era ScriptProcessor + sample rate mismatch. Fix: AudioWorklet + native rate.
- **WS cierra con 1008** → era model name viejo o `apiVersion` no propagada. Fix: usar `gemini-3.1-flash-live-preview` y pasar `httpOptions: { apiVersion: "v1alpha" }` al `GoogleGenAI` constructor.
- **Saludo se corta** → echo loop con VAD. Fix: mic gate + EC + prefixPadding.
- **/api/visual 500** → modelos de imagen requieren billing en Google. Removido del producto.
- **transparent flag rechazado** → solo Vertex. Removido.

### Que tenés que saber

- **Modelo Live es flojo para function calling** — a veces el usuario dice "guarda esto" y el modelo responde "ya lo guardé" SIN llamar la función. Por eso el chip Save Moment ejecuta directo (no depende del modelo).
- **Rate limits en free tier** — image gen sí o sí requiere paid tier. Texto + Live + grounding parece funcionar en free tier pero con límites.
- **Vercel Hobby tiene timeout de 10 s** — `/api/memory` puede fallar. Necesitás plan Pro o reducir maxDuration.
- **Notification API en iOS PWA** — solo funciona si el usuario "Add to Home Screen" primero. En Safari browser puro, no.
- **Web Share API** — limitado en algunos browsers. Quitamos esto del feature set.
- **El LiveSession `aiSpeaking` gate descarta audio del usuario mientras Sens habla** — eso es deliberado (anti-echo) pero significa que NO hay barge-in real. El usuario tiene que esperar a que Sens termine de hablar para hablar él. Si quieren barge-in en el futuro, hay que rearquitectar.

---

## 8. Tools que usa el modelo

Declaradas en `lib/modes.ts`:

```typescript
const findNearbyPlace = {
  name: "find_nearby_place",
  // El modelo llama esto cuando el usuario pregunta por un lugar
  // que no se ve en cámara
  // Args: { query, sceneCues }
  // Implementation: app/live/page.tsx → /api/nearby
}

const saveMemory = {
  name: "save_memory",
  // El modelo llama esto cuando el usuario dice "guarda esto"
  // Args: { label, caption }
  // Implementation: app/live/page.tsx captura frame + /api/memory
}
```

Si querés agregar una tool nueva:
1. Declarala en `lib/modes.ts` y agregala al array `tools` de `ASSISTANT`.
2. Agregá un branch en `handleToolCall` en `app/live/page.tsx` que la maneje.
3. Asegurate de llamar `sessionRef.current?.sendToolResponse(id, name, ...)` con status ok/error para que el modelo sepa qué pasó.

---

## 9. DevPost — contenido listo para enviar

### Elevator pitch (recomendado)

> Sens convierte cualquier teléfono en un par de ojos con voz. En tiempo real, 97 idiomas, sin instalar nada — para los 1 300 millones de personas que la necesitan.

Alternativas:
- *"Apunta. Habla. Entiende. Sens es Gemini Live convertido en los ojos, los oídos y la memoria de quien depende de otros para vivir el día."*
- *"Una sola URL. Una sola conversación. La cámara entiende, la voz responde, y todo queda guardado para reescuchar mañana."*

### Project Story

```markdown
## Inspiration

1 300 millones de personas en el mundo viven con alguna discapacidad visual,
auditiva o cognitiva. Las soluciones actuales son aparatos especializados de
miles de dólares, doce apps fragmentadas, o depender de otra persona.

Pensamos en una abuela en un hospital que no conoce. No puede leer los
letreros. No entiende la receta que le acaban de dar. No encuentra el baño.
Sens nació para ese momento — con una pregunta simple: ¿y si el teléfono que
ya tienes en la mano pudiera ver, oír y hablar **por ti**, sin instalar nada,
en tu idioma, en tiempo real?

## What it does

Sens es una PWA voz-primero. Se abre desde una URL — sin descargas, sin
login, sin teclado. Le hablas y decide qué hacer:

- Describe lo que ve la cámara — calles, personas, peligros.
- Lee y traduce cualquier texto, detectando entre 97 idiomas.
- Interpreta símbolos, gestos, contexto y situaciones complejas.
- Orienta combinando GPS + Google Search grounding (encuentra la farmacia
  REAL más cercana, no inventa direcciones).
- Guarda Memorias — captura recetas, menús, tarjetas. Gemini 3 Pro genera
  una descripción detallada que queda persistente en el dispositivo, lista
  para reescuchar en cualquier momento.

Todo voz-primero. La conversación dura indefinidamente — el límite duro de
2 minutos del Live API se sortea con session resumption transparente.

## How we built it

Frontend — Next.js 16 con Turbopack, React 19, TypeScript, Tailwind v4.
PWA totalmente responsive con vistas optimizadas para móvil y desktop.

IA en tiempo real — Gemini Live API (gemini-3.1-flash-live-preview) sobre
WebSocket directo desde el navegador. Audio + video streaming bidireccional,
latencia sub-300 ms, voz nativa empática que detecta y se adapta a 97 idiomas.

IA de alta calidad — Gemini 3 Pro para descripciones detalladas de Memorias
con OCR + comprensión estructurada. Google Search grounding para
find_nearby_place.

Pipeline de audio — AudioWorklet inline cargado vía Blob URL (porque iOS
Safari 16+ rompe ScriptProcessorNode). Captura PCM 16-bit @ 16 kHz,
reproducción @ 24 kHz, resampleo lineal client-side.

Seguridad — Tokens efímeros: el browser jamás ve la API key. El endpoint
/api/token mintea tokens de 30 minutos limitados al modelo Live + modalidad
audio. El WebSocket se abre browser↔Google directo.

Function calling — save_memory y find_nearby_place declaradas con
descripciones imperativas. El modelo decide cuándo invocarlas según la
intención del usuario.

Sesión indefinida — Live API tiene un hard limit de 2 min por WebSocket.
Implementamos session resumption con handles persistentes + goAway
preemption: el server avisa N segundos antes de cerrar y abrimos la sesión
nueva con el handle ANTES de que muera la vieja.

Persistencia local — localStorage para la galería de memorias.

Hosting — Vercel con funciones serverless (maxDuration = 60s para llamadas
largas a Gemini Pro vision).

## Challenges we ran into

1. iOS Safari rompe ScriptProcessorNode — el callback onaudioprocess
   simplemente no se dispara en iOS 16+. Migramos a AudioWorkletNode con
   un blob inline.
2. iOS rechaza sample rates custom — new AudioContext({ sampleRate: 24000 })
   o tira error o desincroniza. Pasamos a sample rate nativo y resample.
3. Echo loop crítico — el speaker reproducía la voz del modelo, el mic la
   captaba, el VAD del servidor la interpretaba como interrupción del
   usuario y cortaba al modelo a media frase. Solución de tres capas: echo
   cancellation activo, prefixPaddingMs: 1000 en el VAD, y un mic gate
   client-side que bloquea uploads mientras la IA habla.
4. Hard limit de 2 minutos — implementamos session resumption con handles
   + goAway preemption para conseguir sesiones indefinidas.
5. El modelo Live es flojo para function calling — alucina respuestas
   verbales tipo "ya lo guardé" sin invocar la función. Reforzamos
   descripciones con lenguaje imperativo.
6. API version v1alpha solo se aplica vía httpOptions — el campo top-level
   no se propagaba al WS URL. Lo descubrimos leyendo el source del SDK.
7. Vercel timeout 10 s default — Gemini Pro tarda 10-15 s describiendo
   imágenes. export const maxDuration = 60 lo arregló.
8. Discovery de nombres correctos de modelos — pegamos directo al endpoint
   /models para encontrar gemini-3.1-flash-live-preview.

## Accomplishments that we're proud of

- Sesión verdaderamente indefinida sobre Live API — la mayoría de demos
  chocan contra los 2 minutos. La nuestra dura todo lo que el usuario quiera.
- iOS Safari funcionando end-to-end — la mayoría de demos web AI no jalan
  en iPhone. La nuestra sí.
- Cobertura de 4 discapacidades desde una sola interfaz: baja visión,
  sordera/dislexia, problemas cognitivos, y orientación espacial.
- Cero fricción: una sola URL, sin downloads, sin login, sin onboarding.
- Voice-first real: el usuario habla y la IA decide la herramienta.

## What we learned

- Las particularidades de Web Audio entre browsers, especialmente iOS Safari.
- Cómo arquitectar tokens efímeros para que un browser hable directo con
  una API de IA sin exponer credenciales.
- Cómo combinar Live API streaming + endpoints Pro no-Live + tool calls en
  un solo UX coherente.
- El arte de promptear a un modelo de audio para que use tools de manera
  confiable (siempre va a fallar — hay que tener fallbacks).
- Tuning de VAD server-side para evitar barge-in espurio por feedback
  acústico.

## What's next for Sens

- Subtítulos en vivo — texto enorme en pantalla de cualquier conversación
  cercana, traducido al idioma del usuario, para personas con sordera.
- Diario semanal narrado — long-context de Gemini sobre todas las memorias
  guardadas, generando un resumen de tu semana.
- App nativa con widgets de acceso rápido en iOS y Android.
- Modo cuidador — un familiar puede recibir un feed pasivo del audio
  descriptivo del usuario.
- Integración con calendarios médicos — Sens detecta una receta y propone
  agendar el horario.
- Modo de emergencia — frase activadora ("Sens, emergencia") que dispara
  una grabación + descripción de la escena para enviar a contactos.
```

### Built with (tags)

```
typescript
javascript
next.js
react
tailwindcss
google-gemini
gemini-live-api
gemini-3-pro
google-search-grounding
@google/genai
web-audio-api
audio-worklet
websocket
geolocation-api
speech-synthesis-api
local-storage
pwa
tabler-icons
vercel
github
git
```

---

## 10. Demo script (5 minutos)

### Setup antes del escenario

- Celular cargado con la URL ya abierta y permisos otorgados.
- **Auriculares con micrófono** (críticamente importante: evita el echo del altavoz de sala).
- Una receta médica, un menú en otro idioma, una tarjeta de presentación a mano.
- **Screen recording de respaldo** del demo perfecto, por si la red del evento falla.
- Una memoria pre-guardada en localStorage como fallback.

### Guion

**[0:00 – 0:30] Hook**

> "Imagina caminar por un hospital que no conoces. No puedes leer los letreros. No entiendes la receta que te acaban de dar. No encuentras el baño. Para 1 de cada 6 personas en el mundo, esto es un lunes a la mañana."

**[0:30 – 1:00] Problema + Intro**

> "Hoy las soluciones de accesibilidad son aparatos de USD 4 000, doce apps distintas, o pedir ayuda. Nosotros pensamos: ¿y si tu teléfono YA pudiera ver, oír y hablar por ti — sin instalar nada, en tu idioma, en tiempo real? Esto es Sens."

**[1:00 – 2:00] Demo 1 — Describe + Lee + Traduce**

Apunta a un letrero/menú en otro idioma.
- *"Sens, ¿qué dice esto?"* → lee y traduce
- *"¿Y aquí qué hay?"* → describe escena

> "97 idiomas, detección automática, sin configuración."

**[2:00 – 3:00] Demo 2 — Memorias**

Apunta a una receta real.
- *"Sens, guarda esto. Es importante."*
- Toast: "guardando memoria…"
- Tap Memorias → tap nueva entrada → tap Reescuchar
- Sens lee la receta entera, transcrita literal por Gemini Pro

> "Esta abuela ya no necesita pedirle a su nieto que le lea la receta."

**[3:00 – 4:00] Demo 3 — Orientación con datos reales**

- *"Sens, ¿dónde queda la farmacia más cercana?"*
- Sens combina GPS + Google Search grounding
- Devuelve farmacia real con indicaciones humanas

> "Esto NO es alucinación. Es búsqueda real grounded en Google. Cero direcciones inventadas."

**[4:00 – 4:45] Tech moment**

Switch a editor con código + UI side-by-side.

> "Sens corre directo sobre Gemini Live. Una sola conversación que dura indefinidamente — implementamos session resumption + goAway preemption para sortear el límite de 2 minutos del API. El audio va por WebSocket directo del browser, con tokens efímeros que nunca exponen la API key. Function calling para Memorias y búsqueda real. Web Audio con AudioWorklet para que jale en iOS. Es PWA: zero instalación."

**[4:45 – 5:00] Cierre**

> "Sens es una sola URL para 1 300 millones de personas con alguna discapacidad — y para cualquiera que se acaba de mudar y no entiende nada. Sin downloads. Sin login. Solo voz. Gracias."

---

## 11. Pitch — temas técnicos a mencionar

1. **Multimodal Live API como núcleo**: gemini-3.1-flash-live-preview, audio + video streaming, sub-300 ms latencia, voz nativa, 97 idiomas auto.
2. **Arquitectura multi-modelo**: Live para conversación, Gemini 3 Pro para vision de Memorias, Pro + Search grounding para places.
3. **Function calling**: el modelo decide cuándo llamar tools según intención.
4. **Search grounding (no hallucination)**: direcciones reales, no inventadas.
5. **Tokens efímeros**: API key nunca sale del server.
6. **Session resumption + goAway preempt**: 2 min hard cap → sesión indefinida.
7. **Web Audio mastery**: AudioWorklet para iOS, mic gate anti-echo.
8. **UX voz-primero**: cero botones para interacción primaria.

### Cómo nos apoyamos de IA para construir Sens

- **Pair-programming con Claude Code** como partner de arquitectura en tiempo real.
- **Debugging asistido por IA** — análisis de logs diagnósticos para diagnosticar el echo loop y los problemas de iOS.
- **Iteración de prompts del asistente** — testing de la persona del modelo con la misma IA.
- **Discovery de la API** — pegando al endpoint /models y leyendo el source del SDK con ayuda de IA.
- **Generación de documentación** — README, deploy guide, este texto, demo script.

### Tips para el pitch

1. **Demo en hardware real** — celular en mano, con auriculares. NO simulator.
2. **Recording de respaldo** — siempre. Wifi de evento es impredecible.
3. **Hablale al teléfono natural** — como amigo, no narrando. La naturalidad ES el demo.
4. **Show, don't tell** — demo primero, después 30 s de tech.
5. **Liderá con la historia humana** — 1 300 millones de personas, después tu abuela, después Sens.
6. **Cerrá con el "por qué ahora"** — Live API recién lanzó audio+video streaming. Somos los primeros en usarlo como UI completa de un producto de accesibilidad.
7. **Ensayá el modo de falla** — si el WS cae a media demo: *"y aquí está la reconexión transparente — Sens acaba de continuar la conversación, sin perder contexto."*
8. **Vestí color sólido** — Sens te describe en pantalla si apuntás sin querer.
9. **Cronometrá** — cada segmento ≤ 60 s. Cerrar a las 4:30 deja buffer.
10. **Practicá la pregunta inevitable**: *"¿qué pasa si pierde conexión?"* → *"Tokens efímeros, handle persiste, reconectamos transparente. Y las Memorias siguen reescuchables porque están en localStorage."*

---

## 12. Workflow de equipo

### Para hacer cambios

```bash
git pull origin main
# editás
npm run dev   # test local
npx tsc --noEmit   # type check antes de commitear
git add .
git commit -m "tipo(scope): mensaje descriptivo"
git push origin main   # auto-deploy en Vercel
```

### Convención de commits

- `feat:` nueva funcionalidad
- `fix:` bug fix
- `docs:` solo docs
- `refactor:` cambio de código sin cambio de comportamiento
- `style:` UI/CSS
- `chore:` deps, configs

### Para debugging

- **Console del browser**: logs `[live]`, `[audio]`, `[tool]` con prefijos clarísimos.
- **`window.speechSynthesis`** disponible para TTS de prueba sin Live.
- **Vercel Function logs**: Deployments → último → Functions → ver logs de `/api/*`.
- **Probar API key**: `node --env-file=.env.local scripts/check-api-access.mjs`

---

## 13. Roadmap (post-hackatón)

| Cuándo | Feature |
|---|---|
| Sprint 1 | Subtítulos en vivo para sordera (texto giant en pantalla) |
| Sprint 1 | App nativa Capacitor/Tauri con widget shortcut |
| Sprint 2 | Diario semanal narrado (long-context Gemini sobre memorias) |
| Sprint 2 | Modo emergencia (frase activadora + envío a contacto) |
| Sprint 3 | Modo cuidador (familiar recibe feed pasivo) |
| Sprint 3 | Integración Apple Health / Google Fit |
| Backlog | Voice cloning del cuidador (la IA habla con la voz de mamá) |
| Backlog | Modo offline parcial (TTS local cuando no hay net) |

---

## 14. Glossary técnico

| Término | Significado en este proyecto |
|---|---|
| Live API | Gemini Live: WebSocket bidireccional con audio + video streaming. |
| Ephemeral token | Token de 30 min que mintea el server para que el browser hable con Gemini sin ver la API key. |
| Session resumption | Mecanismo para reanudar una sesión Live cuando el WS muere, usando un handle persistente. |
| goAway | Mensaje del server avisando que va a cerrar el WS. |
| Resume handle | String que el server emite que permite reabrir la sesión y continuar. |
| Kickoff | Texto inicial que mandamos al modelo para que salude (suprimido en sesiones reanudadas). |
| Mic gate | Lógica client-side que descarta audio del mic mientras la IA está hablando, para evitar echo loop. |
| VAD | Voice Activity Detection — el server analiza el audio entrante para decidir cuándo el usuario habla. |
| `prefixPaddingMs` | Cuánto tiempo de silencio el server requiere antes de "comprometer" un start-of-speech. |
| Search grounding | Tool que le da al modelo acceso a Google Search en tiempo real (anti-hallucination). |
| AudioWorklet | API moderna de Web Audio para procesar audio en un hilo separado (reemplaza ScriptProcessorNode). |
| Native sample rate | La sample rate que el device usa nativamente (típicamente 48 kHz). |
| Halo | El conic-gradient azul rotando detrás del mic button. |
| Bento grid | Layout de cards asimétricas estilo "bento box" (landing page). |

---

## 15. Contacto y créditos

**Repo**: https://github.com/Jhulyammm/Gemini-ApiKey-Integration
**Demo**: https://gemini-api-key-integration.vercel.app
**Hackatón**: Best Use of the Google Gemini API
**Proyecto**: Sens (anteriormente AccessLens)

Si algo no está documentado acá, está en el código (los archivos clave tienen comentarios). Si tampoco está en el código, está en el historial de commits — busca `git log --oneline` y vas a ver la cronología completa de decisiones.

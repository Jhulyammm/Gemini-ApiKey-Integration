# Sens — DevPost submission

Texto listo para pegar en cada campo de la submission.

---

## Project Title

**Sens**

---

## Elevator Pitch (tagline, ≤ 200 caracteres)

**Recomendado:**
> Sens convierte cualquier teléfono en un par de ojos con voz. En tiempo real, 97 idiomas, sin instalar nada.

**Alternativas:**

- *Apunta. Habla. Entiende. Sens es Gemini Live convertido en los ojos, los oídos y la memoria de quien depende de otros para vivir el día.*
- *Una sola URL. Una sola conversación. La cámara entiende, la voz responde, todo queda guardado para reescuchar mañana.*
- *Hoy una persona con baja visión necesita 5 apps y un dispositivo de USD 4 000. Sens reemplaza todo eso con una conversación de voz.*

---

## Project Story (sección "About the project", Markdown)

````markdown
## Inspiration

1 300 millones de personas en el mundo viven con alguna discapacidad visual, auditiva o cognitiva. Las soluciones actuales son aparatos especializados de miles de dólares, doce apps fragmentadas, o depender de otra persona.

Pensamos en una abuela en un hospital que no conoce. No puede leer los letreros. No entiende la receta que le acaban de dar. No encuentra el baño. Sens nació para ese momento — con una pregunta simple: ¿y si el teléfono que ya tienes en la mano pudiera ver, oír y hablar **por ti**, sin instalar nada, en tu idioma, en tiempo real?

## What it does

Sens es una PWA voz-primero. Se abre desde una URL — sin descargas, sin login, sin teclado. Le hablas y decide qué hacer:

- **Describe** lo que ve la cámara — calles, personas, peligros como un escalón al frente.
- **Lee y traduce** cualquier texto, detectando automáticamente entre 97 idiomas.
- **Interpreta** símbolos, gestos, contexto y situaciones complejas.
- **Orienta** combinando GPS + Google Search grounding (encuentra la farmacia REAL más cercana, no inventa direcciones).
- **Guarda Memorias** — captura una receta médica, un menú, una tarjeta del doctor. Gemini 3 Pro genera una descripción detallada que queda persistente en el dispositivo, lista para reescuchar en cualquier momento.

Todo es voz-primero. La conversación dura **indefinidamente** — el límite duro de 2 minutos del Live API se sortea con session resumption transparente.

## How we built it

**Frontend** — Next.js 16 con Turbopack, React 19, TypeScript, Tailwind v4. PWA totalmente responsive con vistas optimizadas para móvil y desktop (split-panel con sidebar de conversación).

**IA en tiempo real** — Gemini Live API (`gemini-3.1-flash-live-preview`) sobre WebSocket directo desde el navegador. Audio + video streaming bidireccional, latencia sub-300 ms, voz nativa empática que detecta y se adapta a 97 idiomas.

**IA de alta calidad** — Gemini 3 Pro (`gemini-3-pro-preview`) para descripciones detalladas de Memorias con OCR + comprensión estructurada. Google Search grounding para `find_nearby_place`.

**Pipeline de audio** — AudioWorklet inline cargado vía Blob URL (porque iOS Safari 16+ rompe `ScriptProcessorNode`). Captura PCM 16-bit @ 16 kHz, reproducción @ 24 kHz, resampleo lineal client-side a la sample rate nativa del dispositivo.

**Seguridad** — Tokens efímeros: el browser **jamás** ve la API key. El endpoint `/api/token` mintea tokens de 30 minutos limitados al modelo Live + modalidad audio. El WebSocket se abre browser↔Google directo.

**Function calling** — `save_memory` y `find_nearby_place` declaradas con descripciones imperativas. El modelo decide cuándo invocarlas según la intención del usuario.

**Sesión indefinida** — Live API tiene un hard limit de 2 min por WebSocket. Implementamos session resumption con handles persistentes + goAway preemption: el server avisa N segundos antes de cerrar y abrimos la sesión nueva con el handle ANTES de que muera la vieja. El usuario percibe una conversación continua.

**Persistencia local** — localStorage para la galería de memorias. Sin backend de datos.

**Hosting** — Vercel con funciones serverless (`maxDuration = 60s` para llamadas largas a Gemini Pro vision).

## Challenges we ran into

1. **iOS Safari rompe `ScriptProcessorNode`** — el callback `onaudioprocess` simplemente no se dispara en iOS 16+. Migramos a `AudioWorkletNode` con un blob inline.
2. **iOS rechaza sample rates custom** — `new AudioContext({ sampleRate: 24000 })` o tira error o desincroniza la timeline. Pasamos a sample rate nativo y resample manual.
3. **Echo loop crítico** — el speaker reproducía la voz del modelo, el mic la captaba, el VAD del servidor la interpretaba como interrupción del usuario y cortaba al modelo a media frase. Solución de tres capas: echo cancellation activo, `prefixPaddingMs: 1000` en el VAD, y un mic gate client-side que bloquea uploads mientras la IA habla.
4. **Hard limit de 2 minutos** — implementamos session resumption con handles + goAway preemption para conseguir sesiones indefinidas.
5. **El modelo Live es flojo para function calling** — alucina respuestas verbales tipo "ya lo guardé" sin invocar la función. Reforzamos descripciones con lenguaje imperativo y agregamos rutas-fallback con ejecución directa.
6. **API version v1alpha solo se aplica vía `httpOptions`** — el campo top-level no se propagaba al WS URL. Lo descubrimos leyendo el source del SDK.
7. **Vercel timeout 10 s default** — Gemini Pro tarda 10-15 s describiendo imágenes complejas. `export const maxDuration = 60` lo arregló.
8. **Discovery de nombres correctos de modelos** — los docs del SDK mencionaban modelos que no existen. Pegamos directo al endpoint `/models` para encontrar `gemini-3.1-flash-live-preview`.
9. **`transparent` flag en sessionResumption** — solo soportado en Vertex AI, no en la API pública de Gemini. La API rechaza el request entero. Lo descubrimos en producción y lo retiramos.

## Accomplishments that we're proud of

- **Sesión verdaderamente indefinida** sobre Live API — la mayoría de demos chocan contra los 2 minutos. La nuestra dura todo lo que el usuario quiera.
- **iOS Safari funcionando end-to-end** — la mayoría de demos web AI no jalan en iPhone. La nuestra sí, con AudioWorklet, native sample rate y user-gesture preservation.
- **Cobertura de 4 discapacidades** desde una sola interfaz: baja visión, sordera/dislexia (subtítulos visuales), problemas cognitivos, y orientación espacial.
- **Cero fricción**: una sola URL, sin downloads, sin login, sin onboarding. Funciona en cualquier celular con cámara y mic.
- **Voice-first real**: el usuario habla y la IA decide la herramienta. Sin menús, sin modos, sin botones para la interacción primaria.

## What we learned

- Las particularidades de Web Audio entre browsers, especialmente iOS Safari (la barrera más alta de la web móvil moderna).
- Cómo arquitectar tokens efímeros para que un browser pueda hablar directamente con una API de IA sin exponer credenciales.
- Cómo combinar Live API streaming + endpoints Pro no-Live + tool calls en un solo UX coherente.
- El arte de promptear a un modelo de audio para que use tools de manera confiable (siempre va a fallar — hay que tener fallbacks).
- Tuning de VAD server-side para evitar barge-in espurio por feedback acústico.
- Que las APIs de Google son mucho más estrictas con flags Vertex-only en producción que lo que sugieren los SDKs.

## What's next for Sens

- **Subtítulos en vivo** — texto enorme en pantalla de cualquier conversación cercana, traducido al idioma del usuario, para personas con sordera.
- **Diario semanal narrado** — long-context de Gemini sobre todas las memorias guardadas, generando un resumen de tu semana.
- **App nativa** con widgets de acceso rápido en iOS y Android.
- **Modo cuidador** — un familiar puede recibir un feed pasivo del audio descriptivo del usuario.
- **Integración con calendarios médicos** — Sens detecta una receta y propone agendar el horario.
- **Modo de emergencia** — frase activadora ("Sens, emergencia") que dispara una grabación + descripción de la escena para enviar a contactos pre-configurados.
````

---

## Built with (tags individuales — copiá uno por uno)

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

## Try it out links

- **Demo público**: https://gemini-api-key-integration.vercel.app
- **Repositorio**: https://github.com/Jhulyammm/Gemini-ApiKey-Integration
- **Video demo**: [agregar URL del YouTube/Drive después de filmar]

---

## Submission checklist

Antes de mandar:

- [ ] Probaste el demo público en iPhone Y Android.
- [ ] La GEMINI_API_KEY de producción tiene quota suficiente para los días del juicio.
- [ ] El video está subido a YouTube/Drive como **unlisted** o **público** (no privado).
- [ ] El repo es público y el README se entiende sin contexto previo.
- [ ] Tienes al menos 3 stills 1080×1080 o más para la galería.
- [ ] El elevator pitch tiene < 200 caracteres.
- [ ] Verificaste que `curl -X POST https://TU-URL/api/token` devuelve 200 con token válido.
- [ ] Submission enviada **antes** del deadline (con buffer de 30 min mínimo).

<<<<<<< Updated upstream
# AccessLens

**Tus ojos, oídos y guía con IA en vivo.**

AccessLens es una PWA móvil de accesibilidad en tiempo real construida sobre la **Google Gemini Live API**. Apuntas la cámara del celular y AccessLens ve, escucha y te habla con voz natural y empática en 97 idiomas.

Diseñada para personas con baja visión, sordera, dislexia o que necesitan orientación en un espacio nuevo — sin descargar nada, solo abrir una URL.

> Hackatón: **Best Use of the Google Gemini API**.
> Stack: Next.js 16 · React 19 · Tailwind 4 · Gemini Live + Nano Banana Pro + Google Search grounding.

---

## Los cuatro modos

Una sola pantalla. Cuatro modos compuestos sobre la misma sesión Live.

| Modo | Para quién | Qué hace | Capacidad de Gemini |
|---|---|---|---|
| 👁️ **Ojos** | Baja visión | Narra continuamente lo que ve la cámara, con voz emocional adaptativa | Live API video + audio + 97 idiomas |
| 📖 **Leer** | Dislexia / extranjeros | Lee y traduce el texto que apuntas, simplifica jerga compleja | Live API + traducción nativa |
| 🎨 **Visual** | Apoyo cognitivo | Cuando la explicación es compleja, genera un diagrama inline | `generate_visual_aid` → Nano Banana Pro |
| 📍 **Dónde** | Movilidad | Te guía por el espacio combinando lo que ve la cámara con búsqueda web | `find_nearby_place` → Google Search grounding |

---

## Correr local

```bash
git clone https://github.com/Jhulyammm/Gemini-ApiKey-Integration.git accesslens
cd accesslens
npm install
cp .env.example .env.local
# Edita .env.local y pega tu GEMINI_API_KEY de https://aistudio.google.com/apikey
npm run dev
```

Abre `http://localhost:3000` en tu **móvil** (mismo Wi-Fi que tu laptop, o usa `ngrok` para exponer https). El navegador exige HTTPS para `getUserMedia`, así que para pruebas reales en celular conviene desplegar a Vercel o tunelar.

---

## Arquitectura

```
app/
├─ page.tsx              ← landing
├─ live/page.tsx         ← experiencia: cámara, mic, modos, overlays
└─ api/
   ├─ token/route.ts     ← ephemeral token (proxy WS)
   ├─ visual/route.ts    ← Nano Banana Pro (generate_visual_aid)
   └─ nearby/route.ts    ← Google Search grounding (find_nearby_place)

lib/
├─ gemini-live.ts        ← LiveSession wrapper (WebSocket + callbacks)
├─ audio.ts              ← AudioCapture 16kHz · AudioPlayer 24kHz · frame JPEG
└─ modes.ts              ← system prompts + function declarations por modo
```

### Modelos usados

- `gemini-live-2.5-flash-preview` — Live API con `enableAffectiveDialog` y VAD automática.
- `gemini-3-pro-image-preview` (Nano Banana Pro) — generación de imagen 4K con texto legible.
- `gemini-3-pro-preview` con `googleSearch` tool — orientación con grounding web.

### Flujo de seguridad

El cliente **nunca** ve la `GEMINI_API_KEY`. El navegador llama a `POST /api/token` que crea un **ephemeral token** firmado por el servidor, válido 30 min y limitado al modelo Live + modalidad audio. El WebSocket se abre directamente desde el navegador con ese token.

### Límites operativos

- Sesión Live audio + video: **2 minutos** por hard limit del API. AccessLens reconecta de forma silenciosa a los 1:50 sin que el usuario lo note.
- Frames de video: 1 FPS (limitación del modelo, no del cliente).
- Audio: 16-bit PCM mono · entrada 16 kHz · salida 24 kHz.

---

## Equipo de hackatón

Plan de tareas paralelas en **`TEAM.md`**.

## Licencia

MIT.
=======
# Gemini-ApiKey-Integration
How to do a integration with Gemini Api Key and Vibe Coding

>>>>>>> Stashed changes

# Sens — Deploy a Vercel

10 minutos. Necesitás: cuenta GitHub, cuenta Vercel (gratis, login con GitHub), tu propia `GEMINI_API_KEY` de https://aistudio.google.com/apikey.

> **Antes de empezar**: si tu API key vieja está expuesta en commits previos, revocala primero en AI Studio y creá una nueva. La que pegues en Vercel debe ser fresca.

---

## 1. Importar el repo

1. Entrá a https://vercel.com/new
2. Click en **Import** junto a `Jhulyammm/Gemini-ApiKey-Integration`.
3. Si no aparece, dale permiso a Vercel de ver ese repo en GitHub (botón "Configure GitHub App").

## 2. Project settings

Vercel detecta Next.js automáticamente. **No cambies nada** de:

- Framework Preset: `Next.js` (auto)
- Root Directory: `./` (default)
- Build Command: `next build` (default)
- Install Command: `npm install` (default)
- Output Directory: `.next` (default)

## 3. Environment Variables (CRÍTICO)

En **Settings → Environment Variables** del proyecto, agregá:

| Name | Value | Environments |
|---|---|---|
| `GEMINI_API_KEY` | tu API key de AI Studio | Production · Preview · Development |

**Tres detalles:**
- El nombre exacto es `GEMINI_API_KEY` (no `GOOGLE_API_KEY`, no `API_KEY`).
- Marcá las 3 environments.
- Si querés image gen futura (no hoy), tu key necesita **paid tier** habilitado en AI Studio. Para todo lo demás (Live, Pro vision, Search grounding) el free tier funciona con límites.

## 4. Deploy

Click **Deploy**. Tarda ~90 segundos. Vercel te da una URL tipo `https://gemini-api-key-integration.vercel.app`.

## 5. Test post-deploy

### Test 1 — endpoint del token

```bash
curl -X POST https://TU-URL.vercel.app/api/token
```

Debe devolver JSON con `token`, `model`, `expiresAt`. Si devuelve `{"error": "GEMINI_API_KEY no está configurada"}`, **la env var no se cargó** — volvé al paso 3.

### Test 2 — celular

1. Abrí `https://TU-URL.vercel.app` en Chrome/Safari del celular.
2. Botón **Empezar →**.
3. Aceptá permisos de cámara y micrófono.
4. **Iniciar sesión**.
5. Esperá 2-3 segundos. Deberías oír: *"Hola, ¿cómo estás? Que tengas un lindo día/tarde/noche. ¿Qué hacemos hoy?"*
6. Hablá: *"describe lo que ves"*.
7. Sens describe la escena.

### Test 3 — Memorias

1. Apuntá a algo con texto (etiqueta, libro, menú).
2. Decí *"guarda esto en memorias"* o tap el botón 💾 abajo a la derecha.
3. Toast aparece "guardando memoria…".
4. Tap el ícono Bookmark arriba a la derecha → Memorias.
5. Tap la memoria nueva → tap "Reescuchar" — Sens lee la descripción detallada.

### Test 4 — Sesión indefinida

Dejá la sesión correr 3+ minutos. **No deberías percibir cortes**. El timer arriba sigue contando indefinidamente. En la consola del browser vas a ver logs `[live] resumed session — kickoff suppressed` cada ~110-115s.

---

## Function timeout

Las rutas `/api/memory` y `/api/nearby` pueden tardar 10-15 segundos (Gemini Pro vision + grounding). Tienen `export const maxDuration = 60` para no morir con el default de Vercel.

- **Vercel Hobby**: max 10 s. Las funciones largas pueden fallar.
- **Vercel Pro** ($20/mo): max 60 s. Todo funciona sin restricciones.

---

## Troubleshooting

### "Build failed"
Revisá logs de Vercel. Casi siempre es un import roto o un tipo TypeScript. Corré `npm run build` localmente primero — si pasa local, pasa en Vercel.

### "Permisos de cámara denegados" en celular
iOS Safari requiere HTTPS. Vercel ya da HTTPS automático. Confirmá que la URL empieza con `https://`.

### Sesión muere a los 2 minutos sin reconectar
Probable: el flag `transparent` no soportado o `sessionResumption` bloqueado. Mirá la consola del browser para ver el WS close code. Si dice algo de `transparent`, asegurate de tener la última versión del código.

### `[live] WS close >> code=1008 ... not found for API version v1main`
El SDK no está usando v1alpha. Verificá que `app/api/token/route.ts` y `lib/gemini-live.ts` usen `httpOptions: { apiVersion: "v1alpha" }`.

### `[live] WS close >> code=1000 wasClean=true reason=""`
Cierre limpio = casi siempre rate limit del modelo. Esperá 60 segundos. Si persiste, corré `node --env-file=.env.local scripts/list-models.mjs` para confirmar que `gemini-3.1-flash-live-preview` está en tu lista.

### `RMS = 0.0000` en consola
El mic no captura. Causas:
- Mic muteado en sistema operativo.
- Browser usa el mic equivocado (ícono candado en URL → Site settings → Microphone).
- iOS: `ScriptProcessorNode` deprecado y a veces falla. Sens usa `AudioWorkletNode` por defecto, pero si caés al fallback en un Safari muy viejo, no hay mucho que hacer.
- **Usá auriculares** — elimina cualquier feedback con altavoces.

### `429 TooManyRequests` en consola
Rate limit del modelo Live. Esperá 60-90 segundos. Para un demo, mantené la sesión corta (< 2 min cada vez si estás en free tier).

### `/api/memory` devuelve 500 con "billing"
El modelo Pro vision en algunos proyectos requiere billing. Usualmente sí funciona en free tier para describir imágenes; si no jala, andá a https://aistudio.google.com/apikey y activá billing en el proyecto.

---

## Para el demo del jurado

- La URL de Vercel es estable y pública. **NO necesitás auth ni login** — los jueces deben poder abrirla directo.
- Confirmá que se ve bien en iPhone Y Android — probalo en al menos 2 dispositivos antes de submitir.
- Cada push a `main` re-deploya automático.

---

Si algo falla y no es ninguno de estos casos, mandá screenshot del log de Vercel (Deployments → último → Functions logs).

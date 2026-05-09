# Deploy a Vercel — guía rápida

10 minutos. Necesitas: cuenta GitHub, cuenta Vercel (gratis, login con GitHub), tu propia `GEMINI_API_KEY` paid-tier de https://aistudio.google.com/apikey.

> **Antes de empezar**: si tienes una API key vieja expuesta en commits previos del repo, revócala primero en AI Studio y crea una nueva. La que pegues en Vercel debe ser fresca.

---

## 1. Importar el repo

1. Entra a https://vercel.com/new
2. Click en **Import** junto a `Jhulyammm/Gemini-ApiKey-Integration`
3. Si no aparece, dale permiso a Vercel de ver ese repo en GitHub (botón "Configure GitHub App")

## 2. Project settings

Vercel detecta Next.js automáticamente. **No cambies nada** de:

- Framework Preset: `Next.js` (auto)
- Root Directory: `./` (default)
- Build Command: `next build` (default)
- Install Command: `npm install` (default)
- Output Directory: `.next` (default)

## 3. Environment Variables (CRÍTICO)

En la sección **Environment Variables** de la pantalla de import, agrega:

| Name | Value | Environments |
|---|---|---|
| `GEMINI_API_KEY` | tu API key fresca de AI Studio | Production, Preview, Development |

**Tres detalles importantes:**

- El nombre exacto es `GEMINI_API_KEY` (no `GOOGLE_API_KEY`, no `API_KEY`).
- Marca las 3 environments (Production / Preview / Development) para que el preview de PRs y los `vercel dev` también funcionen.
- **NO** marques "Sensitive" si quieres poder leerla después; pero sí es buena práctica marcarla.

## 4. Deploy

Click **Deploy**. Tarda ~90 segundos. Cuando termine, Vercel te da una URL tipo `https://gemini-api-key-integration-xxxx.vercel.app`.

## 5. Test post-deploy (sin esto NO funciona en celular)

### Test 1 — endpoint del token

Abre en cualquier navegador (incluso laptop):
```
https://TU-URL.vercel.app/api/token
```

Manda `GET` por defecto (no soporta GET, devuelve 405). Esto solo prueba que la ruta existe. Para probar real:

```bash
curl -X POST https://TU-URL.vercel.app/api/token
```

Debe devolver JSON con `token`, `model`, `expiresAt`. Si devuelve `{"error": "GEMINI_API_KEY no está configurada"}`, **la env var no se cargó** — vuelve al paso 3.

### Test 2 — celular

1. Abre `https://TU-URL.vercel.app` en Chrome/Safari del celular
2. Botón **Empezar →**
3. Acepta permisos de cámara y micrófono
4. **Iniciar sesión Live**
5. Espera 2-3 segundos. Deberías oír: *"Hola, soy AccessLens, ¿en qué te ayudo?"*
6. Habla: "describe lo que ves"
7. Gemini debería responder describiendo lo que la cámara ve

### Test 3 — Modo Visual (opcional pero impresionante)

En la sesión Live, di: *"dibújame un horario de medicamentos cada 8 horas"*. Después de 5-15 segundos debería aparecer una imagen generada por Nano Banana Pro en pantalla.

---

## Troubleshooting

### "Build failed"
- Revisa logs de Vercel. Casi siempre es un import roto o un tipo TypeScript. Corre `npm run build` localmente primero — si pasa local, pasa en Vercel.

### "Permisos de cámara denegados" en celular
- iOS Safari requiere HTTPS. Vercel ya da HTTPS, así que esto solo debería fallar si abres `http://`. Confirma que la URL empieza con `https://`.

### "[live] WS close >> code=1008 ... not found for API version v1main"
- Significa que el SDK no está usando v1alpha. Esto YA lo arreglamos en el código (`httpOptions: { apiVersion: "v1alpha" }`). Si reaparece, haz pull y verifica que `app/api/token/route.ts` tenga ese campo.

### "[live] WS close >> code=1000 wasClean=true reason=""
- Cierre limpio sin razón = casi siempre rate limit del modelo o el modelo no expuesto. Espera 60 segundos. Si persiste, corre `node --env-file=.env.local scripts/list-models.mjs` localmente con la misma key para confirmar que `gemini-3.1-flash-live-preview` está en la lista.

### "RMS = 0.0000" en consola del navegador
- El mic no captura. Causas comunes:
  - Mic muteado en Windows (Configuración → Sonido → Entrada)
  - Browser usa el mic equivocado (ícono candado en URL → Site settings → Microphone)
  - Echo cancellation está cancelando voz (ya está deshabilitado en `lib/audio.ts`)
  - **Usa headphones** — elimina cualquier feedback con speakers

### "429 TooManyRequests" en consola Vercel o Google Cloud
- Hitting rate limit del modelo Live. Espera 60-90 segundos. Para el demo, mantén la sesión corta (< 1 minuto cada vez).

---

## Para el demo del jurado

- La URL de Vercel es estable y pública. **NO necesitas auth ni login** (los jueces deben poder abrirla directo).
- Confirma que se ve bien en iPhone Y Android — pruébalo en al menos 2 dispositivos antes de submitir.
- Si haces cambios después de deployar, cada push a `main` re-deploya automático.

---

Si algo falla y no es ninguno de los troubleshootings de arriba, manda screenshot del log de Vercel (Deployments → último → Functions logs).

# AccessLens — Plan de tareas paralelas (6-8 h hackatón)

Estado al checkpoint actual:
- ✅ Scaffold Next.js + Tailwind 4 + Gemini SDK
- ✅ Endpoints `/api/token`, `/api/visual`, `/api/nearby`
- ✅ Live API wrapper (`lib/gemini-live.ts`), audio PCM (`lib/audio.ts`), 4 modos (`lib/modes.ts`)
- ✅ UI: landing y live experience con estética "Wayfinding Brutalism"
- ✅ Build TypeScript pasa (`npm run build` ✓)

A partir de aquí el equipo se divide en 4 tracks. Cada track es **paralelo** — ninguno bloquea a otro mientras el código actual no se rompa.

---

## 🅰 Track A — Live API smoke test + tuning de prompts

**Owner:** Dev con celular Android o iPhone reciente y buen mic.
**Objetivo:** Validar el flujo end-to-end en hardware real y ajustar prompts/parámetros.
**Tiempo:** 2-3 h.

### Setup
1. Pega tu API key real en `.env.local` (`GEMINI_API_KEY=...`).
2. Corre `npm run dev` y expón con `ngrok http 3000` o sube a Vercel preview.
3. Abre la URL HTTPS desde el celular, otorga permisos cámara + mic.

### Pruebas (en este orden, anotar bugs en Issues)
| # | Caso | Mide |
|---|---|---|
| 1 | Modo **Ojos**: apunta a tu sala, di "qué ves". | Latencia primer audio < 1.5 s. Voz cálida, no robótica. |
| 2 | Modo **Ojos**: cambia entre español e inglés mid-frase. | El modelo debe seguir el idioma sin avisarle. |
| 3 | Modo **Leer**: apunta a un texto en otro idioma. | Lee traducido + dice idioma original. |
| 4 | Modo **Visual**: pide "dibújame un horario de pastillas X cada 8h". | Llama tool, llega imagen, la voz no se entrecruza con el render. |
| 5 | Modo **Dónde**: pide "¿dónde hay un Starbucks cerca?". | Permiso GPS, llamada Search, respuesta < 5 s. |
| 6 | Sesión continua 2 min → reconect. | El usuario NO debe percibir el corte. |
| 7 | Cambio de modo en vivo. | Cierra sesión, abre nueva, < 2 s. |
| 8 | Mute → unmute. | El audio no se vuelve a activar al unmute (bug conocido si pasa). |

### Tuning probable (editar `lib/modes.ts`)
- Si la AI habla demasiado largo → en `baseRules` reforzar "MÁXIMO 2 frases por turno".
- Si interrumpe pronto al usuario → subir `silenceDurationMs` en `lib/gemini-live.ts` de 800 a 1200.
- Si tarda en arrancar → bajar `prefixPaddingMs` de 50 a 20.
- Si la voz suena monótona → confirmar que `enableAffectiveDialog: true` está pasando (mira la consola del browser durante connect).

### Entregable
PR con:
- Cambios a `lib/modes.ts` y/o `lib/gemini-live.ts`
- Lista de bugs encontrados en `BUGS.md`
- Video corto (30 s) de cada modo funcionando

---

## 🅱 Track B — Demo video (la PIEZA QUE GANA)

**Owner:** Dev con buen ojo audiovisual + acceso a un usuario real (idealmente persona con discapacidad, sino voluntario actuando con respeto).
**Objetivo:** Producir el video de **3 min máx** que entregamos al jurado.
**Tiempo:** 3-4 h.

### Premisa narrativa
"Hoy seguimos a María, 67 años, glaucoma avanzado. Sale de su casa…"
Una persona, un trayecto real, los 4 modos aparecen naturalmente. NO mostrar pantallas separadas por modo — eso pierde.

### Storyboard (3:00 hard cap)
```
0:00–0:15   Hook    María cierra la puerta, abre la URL en el iPhone.
0:15–0:45   Ojos    Cruza la calle. AccessLens describe: "acera amplia,
                    semáforo en rojo, 8 metros, mujer empujando carriola".
0:45–1:15   Leer    En el supermercado: lee menú/etiquetas en otro
                    idioma + filtra ("¿cuál es deslactosada?").
1:15–1:45   Visual  Pregunta cómo tomar un medicamento. Aparece el
                    diagrama Nano Banana Pro, comparte por WhatsApp.
1:45–2:15   Dónde   Pregunta por el baño accesible. AccessLens combina
                    señalética visible + Search → "Pasillo 3, derecha".
2:15–2:45   Beat    María sola, salida del super, camina libre.
2:45–3:00   Stamp   Logo + "AccessLens · Built on Gemini Live API"
```

### Recursos a producir
- Guion exacto (palabra por palabra) en `docs/SCRIPT.md`.
- Captions en pantalla (porque jurados pueden ver muteado): editor a usar = **CapCut** o **DaVinci Resolve free**.
- Música: pedir a la persona alguien con licencia libre (Epidemic Sound, Artlist), tono cálido, NO épico-tech.
- Color grade: contraste alto, sombras profundas, amarillo signal en post para resaltar overlays.

### Filming tips
- iPhone 14+ o Android Pro con estabilizador. Cinematic mode OFF (introduce blur).
- Audio: lavalier en la persona principal o grabador externo. NO mic interno.
- Locación: supermercado real, no maqueta. Pide permiso al gerente.
- B-roll: cámara siguiendo a María de espaldas, manos sosteniendo el celular en POV.

### Entregable
- `docs/SCRIPT.md`
- Video final 3:00 máx en MP4 1080p subido a YouTube como **unlisted** o Drive público.
- 3 stills (1080×1080) para la galería de DevPost.

---

## 🅲 Track C — Deploy + submission package

**Owner:** Dev con cuenta Vercel y experiencia en deploys.
**Objetivo:** URL pública estable + texto de submission listo para pegar.
**Tiempo:** 1.5-2 h.

### Tareas
1. **Deploy a Vercel:**
   ```bash
   npx vercel --prod
   ```
   Configura env var `GEMINI_API_KEY` en el dashboard. **NUNCA** lo dejes en el repo.

2. **Validar HTTPS funciona en celular real** — `getUserMedia` solo corre sobre HTTPS o localhost. La URL `*.vercel.app` ya viene con SSL.

3. **Texto de submission (~200 palabras):**
   Plantilla en `docs/SUBMISSION.md`. Puntos no-negociables:
   - Mencionar **Gemini Live API** en la primera línea.
   - Mencionar **Nano Banana Pro / gemini-3-pro-image-preview** y **Google Search grounding** explícitamente.
   - Decir QUÉ problema resuelve y para QUIÉN (5 millones+ de personas con baja visión solo en LATAM).
   - Cerrar con la frase: *"Built entirely on the Gemini API — Live, multimodal, and grounded."*

4. **Submission DevPost:**
   - Title: AccessLens
   - Tagline (cap 200 char): "Tus ojos, oídos y guía. Asistente de accesibilidad en tiempo real con Gemini Live."
   - Repo URL público.
   - Video URL.
   - Stills.

5. **README final + LICENSE MIT** — confirma que el repo se entiende sin contexto (un juez tiene < 60s para escanearlo).

### Entregable
- URL `accesslens-XXX.vercel.app` funcional desde celular
- `docs/SUBMISSION.md` con el texto final
- Submission enviada en DevPost antes del deadline + screenshot de confirmación

---

## 🅳 Track D — Polish + stretch goals (si sobra tiempo)

**Owner:** Dev sobrante (track flexible).
**Objetivo:** Pequeñas mejoras de alto ROI visual, ninguna obligatoria.
**Tiempo:** lo que quede.

### Ideas ordenadas por impacto/esfuerzo
1. **Onboarding screen** (45 min): primera vez que abres `/live`, mostrar 3 cards "qué hace · cómo hablarle · cómo cambiar de modo". Skip permanente con localStorage.
2. **Haptic feedback** (15 min): `navigator.vibrate(20)` al cambiar de modo en móvil.
3. **Sonido al activar modo** (30 min): un click corto sintético al cambiar — refuerza la sensación de aparato pro.
4. **Avatar de voz visualizado** (1 h): círculo amarillo que pulsa con el audio que sale (ya hay VU del input — agregar uno del output).
5. **Botón "Compartir visual"** (45 min): cuando hay overlay Visual, share API nativo para WhatsApp/Mail/Notes.
6. **PWA instalable** (30 min): banner "Añadir a pantalla de inicio" en iOS/Android.
7. **Modo emergencia / SOS** (2 h, alto riesgo): tap largo en el botón mute manda SMS al contacto de emergencia con coords + última descripción de Eyes. Solo si hay tiempo y un dev con experiencia en Twilio.

---

## Orquestación

| Hora | A (smoke) | B (video) | C (deploy) | D (polish) |
|---|---|---|---|---|
| 0:00 | Setup local + .env | Storyboard + script | Configurar Vercel + GEMINI_API_KEY | — |
| 1:00 | Pruebas 1-4 | Scout locación | Deploy preview live | Onboarding screen |
| 2:00 | Pruebas 5-8 + tuning | Filming arranca | Submission text v1 | Haptic + sonido |
| 3:00 | Bug fixes a `modes.ts` | Edición video | Submission text final | Compartir visual |
| 4:00 | QA final | Color grade + captions | Submit DevPost | — |
| 5:00 | Reserve buffer | Reserve buffer | Reserve buffer | Reserve buffer |

---

## Branch workflow

- `main` siempre buildable (`npm run build` debe pasar).
- Cada track trabaja en su rama: `track-a-smoke`, `track-b-demo`, `track-c-deploy`, `track-d-polish`.
- PR a `main`. Review rápido (no bloquees al equipo).
- No hagas force-push a main.
- Antes de mergear, corre `npm run build` y `npm run lint` localmente.

---

## Contactos rápidos

- Gemini API status: https://status.cloud.google.com/
- Vercel deploy logs: dashboard → Deployments → Last
- DevPost organizer: ver email de inscripción
- Slack/Discord del hackatón: ver canal del evento

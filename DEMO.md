# Sens — Guion del demo (5 minutos)

Documento operacional para grabar el video o presentar en vivo.

---

## Antes del rodaje

### Hardware

- **Celular**: iPhone 13+ o Android Pro reciente, con cámara trasera buena.
- **Auriculares con mic** (CRÍTICO en escenario y muy recomendado en grabación) — evita el feedback altavoz→mic que dispara el VAD del servidor y rompe el demo.
- **Trípode o gimbal** para B-roll estable.
- **Lavalier** opcional para audio de la persona principal.

### Software

- Chrome o Safari en el celular, NUNCA navegador en modo incógnito (puede bloquear permisos persistentes).
- Cargá la URL pública: `https://gemini-api-key-integration.vercel.app`.
- Otorgá permisos de cámara, mic y geolocalización **antes** de grabar.
- Pre-cargá una memoria como fallback (apuntá a algo y guardalo) — así si el demo del momento falla, la galería tiene contenido.

### Atrezo

- Una **receta médica real** o impresa (con dosis, frecuencia, dr.) — para el demo de Memorias.
- Un **menú o letrero en otro idioma** (inglés, francés, japonés) — para Lee + Traduce.
- **Tarjeta de presentación** o etiqueta con info — para una demo extra rápida.
- **Locación**: idealmente exterior con tráfico o un local público, para que `find_nearby_place` tenga contexto real.

### Setup técnico anti-fallo

- **Vercel Pro plan** activo o monitoreado — para que `maxDuration: 60` funcione.
- **Quota de la API key**: confirmar que no estás cerca del límite diario.
- **Conexión 4G/5G estable** o WiFi del lugar testeada.
- **Recording de respaldo**: graba una corrida perfecta del demo el día anterior y tenela lista para mostrar si el live falla.

---

## Estructura (5:00 hard cap)

```
0:00–0:30   Hook — el problema
0:30–1:00   Intro — Sens en una frase
1:00–2:00   Demo 1: Describe + Lee + Traduce
2:00–3:00   Demo 2: Memorias (la pieza emocional)
3:00–4:00   Demo 3: Orientación con Search grounding
4:00–4:45   Tech moment — qué hace especial a Sens
4:45–5:00   Cierre — visión + impacto
```

---

## Guion palabra por palabra

### [0:00 – 0:30] HOOK

*Pantalla en negro. Solo el celular en cuadro, en mano de la persona principal.*

> **"Imagina caminar por un hospital que no conoces. No puedes leer los letreros. No entiendes la receta que te acaban de dar. No encuentras el baño."**
>
> *Pausa de 1 segundo.*
>
> **"Para 1 de cada 6 personas en el mundo, esto es un lunes a la mañana."**

### [0:30 – 1:00] INTRO

*Cierra plano del rostro o el dispositivo encendiendo Sens.*

> **"Hoy las soluciones de accesibilidad son aparatos de cuatro mil dólares, doce apps distintas, o pedir ayuda. Nosotros pensamos: ¿y si tu teléfono YA pudiera ver, oír y hablar por ti — sin instalar nada, en tu idioma, en tiempo real?"**
>
> *Mostrá el celular abriendo la URL.*
>
> **"Esto es Sens."**

### [1:00 – 2:00] DEMO 1 — Describe + Lee + Traduce

*Cámara apuntando al menú/letrero en otro idioma.*

**Tu voz:**
> *"Sens, ¿qué dice esto?"*

*Sens lee y traduce en tiempo real. Subtítulos en pantalla muestran su respuesta.*

*Cambia el ángulo, apuntá a una escena más amplia.*

**Tu voz:**
> *"¿Y aquí qué hay?"*

*Sens describe la escena en una o dos frases.*

**Voz en off (subtitulada):**
> **"97 idiomas, detección automática, sin configuración."**

### [2:00 – 3:00] DEMO 2 — Memorias

*Apuntá a la receta médica real.*

**Tu voz:**
> *"Sens, guarda esto. Es importante."*

*Toast aparece en pantalla: "guardando memoria · Memoria · 14:32".*
*Tap el ícono Bookmark arriba a la derecha. Galería se abre con la memoria recién creada.*
*Tap la memoria. Tap "Reescuchar".*

*Sens lee la receta entera, transcrita literal con OCR de Gemini Pro. La cámara hace zoom al texto en pantalla mientras Sens lo lee.*

**Voz en off:**
> **"Esta abuela ya no necesita pedirle a su nieto que le lea la receta. Y mañana, cuando vaya a la farmacia, la abre y la escucha de nuevo."**

### [3:00 – 4:00] DEMO 3 — Orientación con datos reales

*Cámara apuntando a un punto de la calle, exterior con contexto urbano.*

**Tu voz:**
> *"Sens, ¿dónde queda la farmacia más cercana?"*

*Sens combina GPS + Google Search grounding. Devuelve farmacia REAL con indicaciones humanas: "Hay una farmacia Cruz Verde a 200 metros. Camina dos cuadras al norte, luego derecha por la avenida principal".*

**Voz en off:**
> **"Esto NO es alucinación. Es búsqueda real grounded en Google. Cero direcciones inventadas. Cero turbulencia, cero teclado, cero apps."**

### [4:00 – 4:45] TECH MOMENT

*Switch a una vista split: editor con código a la izquierda + UI a la derecha. O voz en off sobre el video del demo continuando.*

> **"Sens corre directo sobre Gemini Live API. Una sola conversación que dura indefinidamente — implementamos session resumption y goAway preemption para sortear el límite de dos minutos del API. El audio va por WebSocket directo del browser, con tokens efímeros que nunca exponen la API key. Function calling para Memorias y búsqueda real. Web Audio con AudioWorklet para que jale en iOS Safari. Es PWA: zero instalación."**

*B-roll del código relevante o de la consola del browser mostrando los logs `[live]`.*

### [4:45 – 5:00] CIERRE

*Rostro de la persona usando Sens, sonriendo. Foco a la URL en pantalla.*

> **"Sens es una sola URL para mil trescientos millones de personas con alguna discapacidad — y para cualquiera que se acaba de mudar y no entiende nada."**
>
> *Beat.*
>
> **"Sin downloads. Sin login. Solo voz."**
>
> *Logo Sens aparece. URL en pantalla.*
>
> **"Gracias."**

---

## Captions / subtítulos

**Críticos** porque el jurado puede ver el video muteado.

- Sincronizá los subtítulos con tu voz al **±200 ms**.
- Usá fuente **bold sans-serif** (Inter Bold, Bricolage Bold) — alta legibilidad.
- Color: **blanco con stroke negro de 2 px** o caja semi-transparente negra. Nunca solo blanco.
- Tamaño: **6-8 % de la altura del frame** (lectura cómoda en celular).
- Posición: tercio inferior, evitar choque con UI de Sens.

---

## Tomas a capturar (lista de plano)

| # | Toma | Duración | Notas |
|---|---|---|---|
| 1 | Plano detalle del rostro al inicio | 5 s | Iluminación cálida |
| 2 | Plano celular en mano abriendo URL | 5 s | URL legible en pantalla |
| 3 | Apuntar a menú extranjero, voz "qué dice" | 8 s | Audio de Sens claro |
| 4 | Apuntar a escena más amplia, descripción | 6 s | Movimiento natural |
| 5 | Apuntar a receta médica | 5 s | Texto legible, primer plano |
| 6 | "Sens, guarda esto" | 4 s | Voz natural |
| 7 | Toast de guardado en pantalla | 3 s | Captura limpia del UI |
| 8 | Tap bookmark, abrir galería | 4 s | Transición fluida |
| 9 | Tap memoria, tap Reescuchar | 5 s | Audio de la descripción |
| 10 | Apuntar a calle, "dónde queda farmacia" | 6 s | Contexto urbano visible |
| 11 | Respuesta de Sens con dirección real | 8 s | Evidencia de no hallucination |
| 12 | Plano editor con código | 8 s | Foco en `lib/gemini-live.ts` |
| 13 | Plano final del rostro sonriendo | 5 s | Cálido, natural |
| 14 | Logo + URL stamp final | 5 s | Centrado, limpio |

**Total bruto: ~80 s. Edición a 5:00 con voz en off + transiciones.**

---

## Música y sound design

- **Tono**: cálido, esperanzador, NO épico-tech genérico.
- **Sugerencias**: Epidemic Sound > "Ambient Cinematic" o "Hopeful Acoustic". Artlist categorías similares.
- **Volumen**: música a -18 dB cuando hay voz, -10 dB en transiciones.
- **SFX**: pequeño "beep" sutil al activar Sens y al guardar memoria. No abusar.
- **Voz natural del demo**: dejarla limpia, sin reverb, sin compresión agresiva. El espectador tiene que sentir que es real.

---

## Color grade

- **Sombras**: profundas, azul-marino frío para matchear el branding `#080c14`.
- **Mid-tones**: warm para los rostros (skin tones naturales).
- **Highlights**: ligeramente frías, blue-cyan, sin clipping.
- **Saturación**: 95-100 % en UI de Sens, 110 % en exteriores.
- **LUT**: si usás DaVinci, base "Cinematic Soft" + acento azul en sombras.

---

## Backup plan si el demo falla en vivo

Tres niveles de fallback:

1. **WS cae en mitad de la demo** → seguí hablando: *"y aquí está la reconexión transparente — Sens acaba de continuar la conversación, sin perder contexto."* Continuá.
2. **API responde lento o devuelve error** → mostrá la galería de Memorias (datos pre-cargados): *"mientras procesa, miremos memorias guardadas previamente."*
3. **Demo entero rompe** → switchea al recording pre-grabado: *"y aquí los dejo con la corrida que grabamos el día anterior."*

Practicá los tres modos de fallback al menos una vez antes del juicio.

---

## Stills para la galería de DevPost

Capturas requeridas (mínimo 3, idealmente 5):

1. **Hero shot**: persona apuntando el celular a una calle/objeto, con la UI visible.
2. **Memoria abierta**: descripción detallada en pantalla con la imagen capturada arriba.
3. **Subtítulo en vivo**: caption box mostrando la transcripción.
4. **Galería de memorias**: grid de 4-6 thumbnails.
5. **Landing page**: bento grid azul, captura limpia.

Resolución: **1080×1080** (cuadrado) o **1920×1080** (landscape). PNG sin compresión visible.

# Sens — Preparación para el pitch

Documento operacional para presentar Sens ante el jurado del hackatón.

---

## Estructura del pitch (assumiendo 5-7 min totales)

```
0:00–0:30   Hook narrativo
0:30–1:00   Problema + dimensión del impacto
1:00–4:00   Demo en vivo (3 partes)
4:00–5:30   Tech moment
5:30–6:30   Visión + roadmap
6:30–7:00   Q&A buffer / Cierre
```

Si el formato es **3 minutos**: comprimir el demo a 2 partes (Memorias + Search grounding) y saltarse el roadmap.

---

## Mensajes clave (memorizar)

Estos son los **golpes** del pitch. Cada uno cabe en una sola respiración.

1. **El golpe humano**: *"Mil trescientos millones de personas dependen de otros para leer, ver, orientarse. Sens les devuelve autonomía con una conversación de voz."*

2. **El golpe técnico**: *"Sens corre directo sobre Gemini Live API, con tokens efímeros que nunca exponen la key, y session resumption para conversaciones indefinidas."*

3. **El golpe diferenciador**: *"Cero apps que instalar. Cero login. Una sola URL. Cualquier teléfono con cámara y mic."*

4. **El golpe de la verdad**: *"No inventa direcciones. Usa Google Search grounding. Lo que Sens dice, es real."*

5. **El golpe del cierre**: *"Construido completamente sobre Gemini API — Live, multimodal y grounded."*

---

## Temas técnicos a mencionar

Mencioná lo siguiente en orden de prioridad si hay tiempo. **NO** los recites como lista — meté cada uno en su contexto natural.

### 1. Multimodal Live API como núcleo

- Modelo: `gemini-3.1-flash-live-preview`.
- Audio + video streaming bidireccional vía WebSocket.
- Latencia sub-300 ms.
- Voz nativa generada por el modelo (no TTS sobre texto).
- 97 idiomas con detección automática.

> *"El núcleo de Sens es Gemini Live, que nos da audio nativo y comprensión de cámara en el mismo WebSocket, con sub-300 milisegundos de latencia."*

### 2. Arquitectura multi-modelo

- Live model para conversación rápida.
- Gemini 3 Pro para descripciones de Memorias (vision input + text output, alta calidad y mejor OCR).
- Gemini 3 Pro + Google Search grounding para `find_nearby_place`.
- Cada modelo elegido por su fortaleza específica, no usamos el mismo para todo.

> *"Cuando un usuario quiere guardar una memoria, salimos del Live y vamos a Gemini Pro porque su OCR es superior. Cada modelo en su sweet spot."*

### 3. Function calling

- Dos funciones declaradas: `save_memory` y `find_nearby_place`.
- Descripciones imperativas para empujar al modelo a invocarlas.
- El modelo decide cuándo llamarlas según la intención del usuario, no por reglas hardcoded.

> *"Sens no tiene 'modos'. El modelo decide qué función llamar según lo que dices. Le pides 'guarda esto' y dispara `save_memory`. Le preguntas 'dónde queda', dispara `find_nearby_place`."*

### 4. Search grounding (NO hallucination)

- `find_nearby_place` usa `tools: [{ googleSearch: {} }]` en la config del modelo.
- Las direcciones que devuelve son reales y actuales, vienen de Google Search.
- Combinamos GPS del navegador + grounding para localizar al usuario.

> *"La diferencia es que Sens no inventa direcciones. Cuando te dice que hay una farmacia a 200 metros, es porque acaba de buscarla en Google Search en ese momento."*

### 5. Tokens efímeros para seguridad

- El browser jamás ve la API key.
- `/api/token` mintea tokens de 30 minutos en server-side, atados al modelo Live + modalidad audio.
- WebSocket browser↔Google directo después.
- Si alguien sniffea el WS, el token expira en 30 min y solo abre Live (no image gen u otros modelos costosos).

> *"Por seguridad, el browser nunca ve la API key real. Servimos tokens efímeros de 30 minutos limitados al modelo Live."*

### 6. Session resumption + goAway preempt

- Live API tiene un hard limit de 2 minutos por WebSocket.
- Servidor emite `sessionResumptionUpdate` con handles persistentes.
- `goAway` avisa N segundos antes de cerrar; abrimos sesión nueva con el handle ANTES de que muera la vieja.
- Failsafe a 115 s si goAway no llega.
- Kickoff (saludo) suprimido en sesiones reanudadas para no resaludar al usuario.

> *"El Live API tiene un límite de dos minutos por sesión. Lo sorteamos con session resumption: el servidor emite handles que usamos para reabrir transparente. El usuario percibe una sola conversación continua, sin cortes."*

### 7. Web Audio mastery

- AudioWorklet inline (compat iOS Safari 16+, donde ScriptProcessorNode falla silenciosamente).
- Resampleo client-side: captura @ 16 kHz, reproducción @ 24 kHz, contra el rate nativo del device.
- Mic gate: descartamos audio del mic mientras la IA habla, para evitar el echo loop que dispara el VAD del servidor y corta al modelo a media frase.

> *"El mayor reto técnico fue iOS Safari. Tuvimos que migrar a AudioWorklet, manejar sample rates manualmente y construir un mic gate client-side para que el speaker no se contaminara con el mic."*

### 8. UX voz-primero

- Cero botones para interacción primaria.
- El usuario habla y la IA decide la herramienta.
- Botones de respaldo solo para acciones administrativas (settings, save moment, mute toggle).

> *"Conscientemente quitamos los menús. Si tu usuario tiene baja visión o dislexia, hacerlo elegir entre cuatro modos en una pantalla es una barrera. Sens es voz primero, real."*

---

## Cómo nos apoyamos de IA para construir Sens

Mencionar SI EL JURADO PREGUNTA explícitamente, o si querés un acento meta.

- **Pair-programming con Claude Code** — usado como partner de arquitectura en tiempo real. Code review, debugging, trade-offs.
- **Debugging asistido por IA** — cuando el RMS del audio era 0.0 en producción, usamos Claude para analizar logs diagnósticos y llegar al diagnóstico correcto (echo cancellation matando voz del usuario + ScriptProcessorNode fallando en iOS).
- **Iteración de prompts del asistente** — testeamos la persona del modelo Sens con la misma IA, iterando system prompts para balancear calidez con concisión.
- **Discovery de la API** — pegamos al endpoint `/models` y leímos el source del SDK con ayuda de IA cuando los docs no alcanzaban (los docs mencionaban modelos que no existían).
- **Documentación generada con IA** — README, deploy guide, este texto, demo script. Generado con IA y pulido a mano.

> *"Construimos Sens en pair-programming con Claude Code. La IA fue partner de arquitectura, no solo de syntax — particularmente en el debug de Web Audio en iOS, donde los síntomas eran sutiles y los docs incompletos."*

---

## Tips operacionales

### Antes del pitch

1. **Demo en hardware real** — celular en mano, no simulator. Auriculares con mic.
2. **Recording de respaldo siempre** — rate limits, wifi del evento, glitches del network. Una corrida perfecta grabada el día anterior, lista para mostrar.
3. **Testeá el WiFi del lugar** o usá tu propio hotspot 4G/5G. El WiFi de eventos es notoriamente inestable.
4. **Vestí color sólido** — blanco, navy, gris. Sens te describe en pantalla si apuntás sin querer al rostro; los estampados confunden la cámara.
5. **Cronometrá** — cada segmento ≤ 60 s. Cerrar a las 4:30 deja 30 s de buffer / pausa para impacto.
6. **Memorias precargadas** — guardá una memoria con info real (receta, tarjeta) antes del pitch. Si la captura del momento falla, mostrás la guardada.

### Durante el pitch

1. **Hablale al teléfono natural** — como a un amigo, no narrando como locutor. La naturalidad ES el demo. Si suenas como robot, la magia se rompe.
2. **Show, don't tell** — NO expliques arquitectura antes del demo. Demo primero, los volás de la silla, después 30 s de tech.
3. **Liderá con la historia humana** — 1 300 millones de personas con discapacidad. Después tu abuela que no puede leer. Después Sens. Las cifras abren puertas, las personas las atraviesan.
4. **Cerrá con el "por qué ahora"** — Gemini Live recién lanzó audio + video streaming. Sens es el primer producto que lo usa como UI completa de accesibilidad.
5. **Ensayá el modo de falla** — si el WS cae a media demo, tenés línea preparada: *"y aquí está la reconexión transparente — Sens acaba de continuar la conversación, sin perder contexto."* (Aunque no haya pasado, vendelo. La sesión indefinida ES un feature, mostralo.)

### Después del pitch — preguntas inevitables

| Pregunta | Respuesta corta |
|---|---|
| *"¿Qué pasa si pierde conexión?"* | "Tokens efímeros expiran en 30 min, el handle persiste. Reconectamos transparente sin perder contexto. Y las Memorias guardadas siguen reescuchables porque están en localStorage del dispositivo." |
| *"¿Cómo monetizan?"* | "B2C freemium con cap de minutos diarios. B2B para hospitales, museos, aerolíneas que quieran ofrecer accesibilidad sin construirla. Y partnership con instituciones de personas con discapacidad para distribución gratuita." |
| *"¿Por qué no app nativa?"* | "Web significa cero descargas, cero permisos de la app store, instant-on. Y PWA permite Add to Home Screen para que se sienta como app si el usuario quiere." |
| *"¿Privacidad?"* | "Audio y video van directo a Google con token efímero. Memorias se guardan en localStorage del dispositivo, no en nuestros servidores. No tenemos backend de datos. Tu información es tuya." |
| *"¿Por qué Gemini y no GPT-4o / Claude?"* | "Gemini Live es la única API de production con streaming bidireccional audio + video nativo en el mismo WebSocket, con detección de 97 idiomas y voz natural empática. Y el grounding con Google Search es directo, sin orquestar otra API." |
| *"¿Funciona offline?"* | "La conversación con Sens necesita internet por el Live API. Pero las Memorias guardadas en localStorage se pueden reescuchar offline porque la descripción ya está cacheada como texto y la TTS la genera el browser localmente." |
| *"¿Por qué solo 2 funciones (find_nearby_place, save_memory) y no 10?"* | "Decisión consciente. Cada función que agregamos diluye la confiabilidad del function calling del modelo Live. Preferimos dos funciones que SIEMPRE funcionan que diez que fallan al azar." |

### Si te ponen en aprietos

- *"El demo no me convence, parece simple"* → "Lo simple ES el feature. Una persona con baja visión no quiere doce apps. Quiere abrir el celular y hablar. La complejidad técnica de hacer eso simple está en la arquitectura — pero es invisible para el usuario, como debe ser."
- *"¿Cómo evitan hallucinations?"* → "Tres capas: prompt explícito que prohíbe inventar detalles, search grounding para datos del mundo real, y descripciones de funciones imperativas para que llame tools en lugar de adivinar."
- *"¿Por qué no tienen image generation?"* → "Lo tuvimos pero requería paid tier de Google AI Studio que no asumimos para una demo. Está fuera por ahora; volverá si los usuarios lo piden con prioridad."

---

## Slides recomendadas (si necesitás soporte visual)

Solo 4-5 slides total. Cada una en pantalla ≤ 30 s.

### Slide 1 — Cover

- Logo Sens centrado.
- Tagline: *"Tus ojos, oídos y guía con IA en vivo."*
- URL: `gemini-api-key-integration.vercel.app`

### Slide 2 — El problema

- Headline grande: *"1 300 millones."*
- Sub: *"de personas dependen de otros para vivir el día."*
- Foto cálida de alguien usando un celular (cliché de stock evitar — usá foto real si podés).

### Slide 3 — Demo en vivo

- Solo el celular en cuadro (proyectado o vía feed).
- No slide, solo el live demo.

### Slide 4 — Tech stack visual

- Diagrama: Browser → ephemeral token → Gemini Live (audio + video WS) + paralelo a Gemini Pro (memory) y Search grounding (places).
- Mantenelo limpio, máximo 8 elementos.

### Slide 5 — Cierre

- *"Construido completamente sobre Gemini API."*
- *"Live · Multimodal · Grounded."*
- URL + logo.

---

## Práctica recomendada antes del juicio

1. **Día -2**: leer este doc completo. Memorizar los 5 mensajes clave.
2. **Día -1**: practicar el pitch entero contra cronómetro **al menos 3 veces**. Grabarse en video y autoevaluarse.
3. **Día -1**: practicar las preguntas inevitables con un compañero como devil's advocate.
4. **Día -1 noche**: grabar el recording de respaldo del demo. Subirlo a YouTube/Drive.
5. **Día del pitch, 1 h antes**: testear conexión, abrir la URL en el celular, otorgar permisos, hacer una corrida silenciosa completa.
6. **Día del pitch, 5 min antes**: cerrá los ojos, respirá hondo, repasá los 5 mensajes clave una última vez.

Vamos con todo. 🎯

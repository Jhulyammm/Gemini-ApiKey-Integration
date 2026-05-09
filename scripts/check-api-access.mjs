import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
if (!apiKey) {
  console.error("❌ GEMINI_API_KEY no está en el entorno.");
  console.error("   Edita .env.local y pega tu key, luego corre:");
  console.error("   node --env-file=.env.local scripts/check-api-access.mjs");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });

const banner = (label) =>
  console.log("\n────────────────────────────────────────\n " + label);

async function probeText(label, model, opts = {}) {
  const start = Date.now();
  try {
    const res = await ai.models.generateContent({
      model,
      contents: opts.contents ?? 'Responde literalmente: "ok"',
      config: opts.config,
    });
    const ms = Date.now() - start;
    const text =
      res.candidates?.[0]?.content?.parts
        ?.map((p) => p.text)
        .filter(Boolean)
        .join(" ")
        .trim() ?? "";
    console.log(`✅ ${label}`);
    console.log(`   model=${model}  latency=${ms}ms`);
    console.log(`   reply="${text.slice(0, 80)}"`);
  } catch (e) {
    console.log(`❌ ${label}`);
    console.log(`   model=${model}`);
    console.log(`   error: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function probeImage(label, model) {
  const start = Date.now();
  try {
    const res = await ai.models.generateContent({
      model,
      contents:
        "Genera una imagen muy simple: círculo amarillo sólido sobre fondo negro, sin texto.",
    });
    const ms = Date.now() - start;
    const parts = res.candidates?.[0]?.content?.parts ?? [];
    const hasImage = parts.some((p) => p.inlineData?.data);
    if (hasImage) {
      const inline = parts.find((p) => p.inlineData?.data);
      const sizeKb = Math.round((inline?.inlineData?.data?.length ?? 0) * 0.75 / 1024);
      console.log(`✅ ${label}`);
      console.log(`   model=${model}  latency=${ms}ms  size≈${sizeKb}KB`);
    } else {
      console.log(`⚠️  ${label}: el modelo respondió pero sin imagen`);
      console.log(`   model=${model}`);
    }
  } catch (e) {
    console.log(`❌ ${label}`);
    console.log(`   model=${model}`);
    console.log(`   error: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function probeLiveToken() {
  const start = Date.now();
  try {
    const aiAlpha = new GoogleGenAI({ apiKey, apiVersion: "v1alpha" });
    const expireTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const newSessionExpireTime = new Date(Date.now() + 2 * 60 * 1000).toISOString();
    const token = await aiAlpha.authTokens.create({
      config: {
        expireTime,
        newSessionExpireTime,
        uses: 1,
        liveConnectConstraints: {
          model: "gemini-live-2.5-flash-preview",
          config: { responseModalities: ["AUDIO"] },
        },
      },
    });
    const ms = Date.now() - start;
    if (token.name) {
      console.log(`✅ Live API ephemeral token (gemini-live-2.5-flash-preview)`);
      console.log(`   token=${token.name.slice(0, 20)}...  latency=${ms}ms`);
    } else {
      console.log("⚠️  Live API: respuesta vacía");
    }
  } catch (e) {
    console.log(`❌ Live API token mint`);
    console.log(`   error: ${e instanceof Error ? e.message : String(e)}`);
  }
}

console.log("Probing Gemini API access (key: " + apiKey.slice(0, 6) + "..." + apiKey.slice(-4) + ")");

banner("1) Free-tier baseline");
await probeText("Generación texto básica", "gemini-2.5-flash");

banner("2) Frontier text model (paid tier)");
await probeText("Texto Pro", "gemini-3-pro-preview");

banner("3) Search grounding (modo Where)");
await probeText("Search grounding", "gemini-3-pro-preview", {
  contents: "¿Qué hora es ahora mismo en Tokio? Responde corto.",
  config: { tools: [{ googleSearch: {} }] },
});

banner("4) Nano Banana Pro (modo Visual)");
await probeImage("Image gen Pro", "gemini-3-pro-image-preview");

banner("5) Live API (modos Eyes/Read)");
await probeLiveToken();

console.log("\n────────────────────────────────────────");
console.log("Si los 5 salen ✅ todo está listo para `npm run dev`.");
console.log("Si Visual o Where salen ❌ con error de billing/quota,");
console.log("activa billing en el proyecto: https://aistudio.google.com/apikey");

import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Nano Banana Pro can take 15-30s for a 4K image — Vercel's default 10s timeout
// kills the function and returns 500. 60s is the max for Vercel Pro plan.
export const maxDuration = 60;

const IMAGE_MODEL = "gemini-3-pro-image-preview";
const FALLBACK_IMAGE_MODEL = "gemini-2.5-flash-image-preview";

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY no está configurada en el entorno" },
      { status: 500 }
    );
  }

  let body: { description?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const description = body.description?.trim();
  if (!description) {
    return NextResponse.json(
      { error: "Falta el campo 'description'" },
      { status: 400 }
    );
  }

  const prompt = `Genera una imagen tipo infografía clara, bold y accesible para una persona con baja visión. Alto contraste (fondos sólidos oscuros o muy claros, texto grande, mínimo iconos finos). Estilo: editorial moderno, paleta limitada (máximo 4 colores con un acento amarillo #f5d442). El texto en la imagen debe ser perfectamente legible, sin tipografías delgadas. Idioma del texto: español.

PETICIÓN DEL USUARIO:
${description}`;

  const ai = new GoogleGenAI({ apiKey });

  const tryGenerate = async (model: string) => {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
    });
    const parts = response.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts) {
      const inline = part.inlineData;
      if (inline?.data) {
        return {
          mimeType: inline.mimeType ?? "image/png",
          dataBase64: inline.data,
          modelUsed: model,
        };
      }
    }
    return null;
  };

  console.log(`[api/visual] start, prompt length=${prompt.length}`);
  const t0 = Date.now();
  try {
    let result: { mimeType: string; dataBase64: string; modelUsed: string } | null = null;
    try {
      result = await tryGenerate(IMAGE_MODEL);
    } catch (primaryErr) {
      console.warn(
        `[api/visual] primary ${IMAGE_MODEL} threw:`,
        primaryErr instanceof Error ? primaryErr.message : String(primaryErr)
      );
    }
    if (!result) {
      console.log(`[api/visual] falling back to ${FALLBACK_IMAGE_MODEL}`);
      result = await tryGenerate(FALLBACK_IMAGE_MODEL);
    }
    if (!result) {
      console.error("[api/visual] both models returned no image");
      return NextResponse.json(
        { error: "El modelo no devolvió una imagen" },
        { status: 502 }
      );
    }
    console.log(
      `[api/visual] ok in ${Date.now() - t0}ms via ${result.modelUsed}, ${result.dataBase64.length}b64`
    );
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[api/visual] failed in ${Date.now() - t0}ms:`, message);
    // Detect the very common "API key has no billing" error so the client can
    // surface a useful instruction instead of a generic 500.
    if (/quota|RESOURCE_EXHAUSTED|free_tier|paid plan|upgrade/i.test(message)) {
      return NextResponse.json(
        {
          error:
            "Tu API key de Google no tiene facturación habilitada para generación de imágenes. Activa billing en https://aistudio.google.com/apikey y vuelve a intentar.",
          needsBilling: true,
          original: message,
        },
        { status: 402 }
      );
    }
    return NextResponse.json(
      { error: `No se pudo generar la imagen: ${message}` },
      { status: 500 }
    );
  }
}

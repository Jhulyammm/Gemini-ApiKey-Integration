import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  try {
    let result = await tryGenerate(IMAGE_MODEL);
    if (!result) {
      result = await tryGenerate(FALLBACK_IMAGE_MODEL);
    }
    if (!result) {
      return NextResponse.json(
        { error: "El modelo no devolvió una imagen" },
        { status: 502 }
      );
    }
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json(
      { error: `No se pudo generar la imagen: ${message}` },
      { status: 500 }
    );
  }
}

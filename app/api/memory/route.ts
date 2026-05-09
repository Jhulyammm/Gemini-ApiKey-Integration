import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Memory descriptions need detail and accuracy (this is what the user will hear when
// they review the memory later), so we use a non-Live frontier text+vision model
// instead of the Live model. Cheap fallback if Pro isn't available on the key.
const PRIMARY_MODEL = "gemini-3-pro-preview";
const FALLBACK_MODEL = "gemini-2.5-flash";

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY no está configurada en el entorno" },
      { status: 500 }
    );
  }

  let body: { imageBase64?: string; mimeType?: string; label?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const imageBase64 = body.imageBase64?.trim();
  if (!imageBase64) {
    return NextResponse.json(
      { error: "Falta el campo 'imageBase64'" },
      { status: 400 }
    );
  }

  const mimeType = body.mimeType ?? "image/jpeg";
  const label = body.label?.trim() || "Memoria sin título";

  const prompt = `Estás describiendo una imagen para una persona con baja visión que la guardó como "memoria" para revisar después. La persona NO podrá ver la imagen — solo escuchará tu descripción cuando toque la memoria en su galería.

Etiqueta del usuario: "${label}"

Genera una descripción detallada y útil en español de la imagen (máximo 6 frases). Incluye:
- Qué es el objeto / documento / escena principal.
- Cualquier TEXTO LEGIBLE en la imagen, transcrito literal (esto es lo más importante: si es una receta, un menú, una etiqueta, una tarjeta, lee TODO el texto que se vea con claridad).
- Detalles relevantes: colores, tamaños, fechas, nombres, números de teléfono, direcciones.
- Si es un documento médico/oficial, identifica claramente el tipo (receta, identificación, factura, etc.).

NO inventes información que no esté visible. Si algo no se distingue, di "no logro distinguir [eso]".`;

  const ai = new GoogleGenAI({ apiKey });

  const tryGenerate = async (model: string) => {
    return ai.models.generateContent({
      model,
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            { inlineData: { mimeType, data: imageBase64 } },
          ],
        },
      ],
    });
  };

  try {
    let response;
    try {
      response = await tryGenerate(PRIMARY_MODEL);
    } catch {
      response = await tryGenerate(FALLBACK_MODEL);
    }

    const text =
      response.candidates?.[0]?.content?.parts
        ?.map((p) => p.text)
        .filter(Boolean)
        .join(" ") ?? "";

    return NextResponse.json({ description: text.trim() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json(
      { error: `No se pudo describir la memoria: ${message}` },
      { status: 500 }
    );
  }
}

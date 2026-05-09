import { GoogleGenAI, GoogleSearch } from "@google/genai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Search grounding can take 5-15s while the model walks Google results.
export const maxDuration = 60;

const TEXT_MODEL = "gemini-3-pro-preview";
const FALLBACK_MODEL = "gemini-2.5-flash";

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY no está configurada en el entorno" },
      { status: 500 }
    );
  }

  let body: { query?: string; sceneCues?: string; lat?: number; lng?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const query = body.query?.trim();
  if (!query) {
    return NextResponse.json(
      { error: "Falta el campo 'query'" },
      { status: 400 }
    );
  }

  const locationLine =
    typeof body.lat === "number" && typeof body.lng === "number"
      ? `Ubicación aproximada del usuario: lat=${body.lat.toFixed(5)}, lng=${body.lng.toFixed(5)}.`
      : "No tengo la ubicación GPS exacta del usuario.";

  const prompt = `Eres un guía de orientación para una persona con baja visión.
${locationLine}

Pistas visuales que el usuario reportó desde la cámara:
${body.sceneCues || "(ninguna)"}

El usuario busca: "${query}".

Devuelve UNA respuesta CORTA, hablada, con pasos accionables ("3 pasos al frente, gira a la derecha"). Si necesitas datos del mundo real (un negocio cercano, un horario, una dirección), úsalo. Mantén la respuesta en español, máximo 3 frases.`;

  const ai = new GoogleGenAI({ apiKey });

  const tryGenerate = async (model: string) => {
    return ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} as GoogleSearch }],
      },
    });
  };

  try {
    let response;
    try {
      response = await tryGenerate(TEXT_MODEL);
    } catch {
      response = await tryGenerate(FALLBACK_MODEL);
    }

    const text =
      response.candidates?.[0]?.content?.parts
        ?.map((p) => p.text)
        .filter(Boolean)
        .join(" ") ?? "";

    return NextResponse.json({ text: text.trim() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json(
      { error: `No se pudo resolver el lugar: ${message}` },
      { status: 500 }
    );
  }
}

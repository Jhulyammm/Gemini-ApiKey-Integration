import { GoogleGenAI, Modality } from "@google/genai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIVE_MODEL = "gemini-3.1-flash-live-preview";

export async function POST() {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY no está configurada en el entorno" },
      { status: 500 }
    );
  }

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { apiVersion: "v1alpha" },
    });

    const expireTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const newSessionExpireTime = new Date(Date.now() + 2 * 60 * 1000).toISOString();

    const token = await ai.authTokens.create({
      config: {
        expireTime,
        newSessionExpireTime,
        uses: 1,
        liveConnectConstraints: {
          model: LIVE_MODEL,
          config: {
            responseModalities: [Modality.AUDIO],
          },
        },
      },
    });

    return NextResponse.json({
      token: token.name,
      model: LIVE_MODEL,
      expiresAt: expireTime,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json(
      { error: `No se pudo generar token efímero: ${message}` },
      { status: 500 }
    );
  }
}

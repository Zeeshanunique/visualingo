import { NextRequest, NextResponse } from "next/server";

// Sarvam TTS returns base64 WAV audio for Indian languages.
export async function POST(req: NextRequest) {
  const { text, languageCode } = await req.json();

  if (!text) {
    return NextResponse.json({ error: "Missing text" }, { status: 400 });
  }

  const res = await fetch("https://api.sarvam.ai/text-to-speech", {
    method: "POST",
    headers: {
      "api-subscription-key": process.env.SARWAM_API_KEY!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      target_language_code: languageCode ?? "en-IN",
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    return NextResponse.json({ error: errText }, { status: res.status });
  }

  const data = await res.json();
  const audioBase64 = data.audios?.[0] ?? null;
  return NextResponse.json({ audioBase64 });
}

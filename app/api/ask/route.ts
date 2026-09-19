import { NextRequest, NextResponse } from "next/server";

// One Gemini call covers vision encoding, captioning, object/scene
// understanding, VQA, and translation — no separate pipeline needed.
export async function POST(req: NextRequest) {
  const { mediaBase64, mimeType, question, persona, language } =
    await req.json();

  if (!mediaBase64 || !mimeType || !question) {
    return NextResponse.json({ error: "Missing media or question" }, { status: 400 });
  }

  const personaLine = persona
    ? `Explain as if the user is a ${persona}: adjust tone and detail accordingly. `
    : "";
  const languageLine = language && language !== "English"
    ? `Answer in ${language}. `
    : "";

  const prompt = `${personaLine}${languageLine}Question: ${question}`;

  const body = JSON.stringify({
    contents: [
      {
        parts: [
          { inline_data: { mime_type: mimeType, data: mediaBase64 } },
          { text: prompt },
        ],
      },
    ],
  });

  async function callModel(model: string) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(25_000),
      }
    );
    return res;
  }

  // ponytail: gemini-3.6-flash has been returning 503/hanging under Google's
  // own load lately, so fall back to flash-lite instead of failing outright.
  const MODELS = ["gemini-3.1-flash-lite", "gemini-3.6-flash"];

  let lastError = "";
  for (const model of MODELS) {
    let res: Response;
    try {
      res = await callModel(model);
    } catch (err: any) {
      lastError = err.name === "TimeoutError" || err.name === "AbortError"
        ? `${model} didn't respond in time`
        : String(err);
      continue;
    }

    if (!res.ok) {
      lastError = await res.text();
      continue;
    }

    const data = await res.json();
    const candidate = data.candidates?.[0];
    const answer = candidate?.content?.parts?.[0]?.text ?? "";

    if (answer) {
      return NextResponse.json({ answer, model });
    }
    lastError = `No answer returned (finishReason: ${candidate?.finishReason ?? "unknown"})`;
  }

  return NextResponse.json({ error: `All models failed. Last error: ${lastError}` }, { status: 502 });
}

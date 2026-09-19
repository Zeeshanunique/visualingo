"use client";

import { useRef, useState } from "react";

const LANGUAGES: Record<string, string> = {
  English: "en-IN",
  Hindi: "hi-IN",
  Kannada: "kn-IN",
  Tamil: "ta-IN",
  Telugu: "te-IN",
  Malayalam: "ml-IN",
  Marathi: "mr-IN",
  Bengali: "bn-IN",
  Gujarati: "gu-IN",
  Punjabi: "pa-IN",
  Odia: "od-IN",
};

const PERSONAS = ["", "child", "student", "tourist", "visually impaired person"];

function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function Home() {
  const [media, setMedia] = useState<{ base64: string; mimeType: string; previewUrl: string } | null>(null);
  const [question, setQuestion] = useState("");
  const [persona, setPersona] = useState("");
  const [language, setLanguage] = useState("English");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const base64 = await fileToBase64(file);
    setMedia({ base64, mimeType: file.type, previewUrl: URL.createObjectURL(file) });
    setAnswer("");
    setError("");
  }

  function startListening() {
    // ponytail: browser-native STT, no server round trip. Chrome/Edge only.
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError("Speech recognition isn't supported in this browser — try Chrome, or type the question.");
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = "en-IN";
    recognition.onresult = (e: any) => setQuestion(e.results[0][0].transcript);
    recognition.onstart = () => setListening(true);
    recognition.onend = () => setListening(false);
    recognition.start();
  }

  async function ask() {
    if (!media || !question) return;
    setLoading(true);
    setError("");
    setAnswer("");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 35_000);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mediaBase64: media.base64,
          mimeType: media.mimeType,
          question,
          persona,
          language,
        }),
        signal: controller.signal,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      setAnswer(data.answer);
    } catch (err: any) {
      setError(err.name === "AbortError" ? "Timed out after 35s — Gemini may be blocking this image/question, try a different one." : err.message);
    } finally {
      clearTimeout(timeout);
      setLoading(false);
    }
  }

  async function speak() {
    if (!answer) return;
    setError("");
    try {
      const res = await fetch("/api/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: answer, languageCode: LANGUAGES[language] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "TTS failed");
      if (audioRef.current) {
        audioRef.current.src = `data:audio/wav;base64,${data.audioBase64}`;
        audioRef.current.play();
      }
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      <main className="mx-auto max-w-xl px-6 py-12 flex flex-col gap-6">
        <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">Visualingo</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Upload an image or video, ask a question by typing or speaking, and get an answer — optionally
          personalized and translated, with audio playback.
        </p>

        <input
          type="file"
          accept="image/*,video/*"
          onChange={handleFile}
          className="text-sm text-black dark:text-zinc-50"
        />

        {media && media.mimeType.startsWith("image/") && (
          <img src={media.previewUrl} alt="preview" className="max-h-64 rounded-lg border" />
        )}
        {media && media.mimeType.startsWith("video/") && (
          <video src={media.previewUrl} controls className="max-h-64 rounded-lg border" />
        )}

        <div className="flex gap-2">
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask a question about the media…"
            className="flex-1 rounded-lg border px-3 py-2 text-sm text-black dark:text-zinc-50 dark:bg-zinc-900"
          />
          <button
            onClick={startListening}
            className="rounded-lg border px-3 py-2 text-sm text-black dark:text-zinc-50"
          >
            {listening ? "Listening…" : "🎤"}
          </button>
        </div>

        <div className="flex gap-3 text-sm">
          <select
            value={persona}
            onChange={(e) => setPersona(e.target.value)}
            className="rounded-lg border px-2 py-1 text-black dark:text-zinc-50 dark:bg-zinc-900"
          >
            <option value="">No persona</option>
            {PERSONAS.filter(Boolean).map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>

          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="rounded-lg border px-2 py-1 text-black dark:text-zinc-50 dark:bg-zinc-900"
          >
            {Object.keys(LANGUAGES).map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </div>

        <button
          onClick={ask}
          disabled={!media || !question || loading}
          className="rounded-lg bg-black text-white dark:bg-white dark:text-black px-4 py-2 text-sm font-medium disabled:opacity-40"
        >
          {loading ? "Thinking…" : "Ask"}
        </button>

        {error && <p className="text-sm text-red-600">{error}</p>}

        {answer && (
          <div className="rounded-lg border p-4 flex flex-col gap-3">
            <p className="text-sm text-black dark:text-zinc-50 whitespace-pre-wrap">{answer}</p>
            <button
              onClick={speak}
              className="self-start rounded-lg border px-3 py-1.5 text-sm text-black dark:text-zinc-50"
            >
              🔊 Play audio
            </button>
            <audio ref={audioRef} className="hidden" />
          </div>
        )}
      </main>
    </div>
  );
}

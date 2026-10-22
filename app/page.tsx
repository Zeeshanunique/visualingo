"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

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

const PERSONAS = [
  { value: "", label: "Default", hint: "Clear, general explanation" },
  { value: "child", label: "Child", hint: "Simple words, curious tone" },
  { value: "student", label: "Student", hint: "A bit more detail and context" },
  { value: "tourist", label: "Tourist", hint: "Practical, place-aware framing" },
  {
    value: "visually impaired person",
    label: "Visually impaired",
    hint: "Rich spatial description for listening",
  },
] as const;

const QUICK_PROMPTS = [
  "What is this?",
  "Describe the scene",
  "Anything important I should notice?",
];

const MAX_FILE_BYTES = 8 * 1024 * 1024;

type MediaState = {
  base64: string;
  mimeType: string;
  previewUrl: string;
  label: string;
  sizeLabel: string;
};

type ErrorScope = "media" | "mic" | "ask" | "tts" | "";

function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Plain text for TTS — strip common markdown markers Gemini returns. */
function markdownToSpeech(text: string) {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export default function Home() {
  const [media, setMedia] = useState<MediaState | null>(null);
  const [question, setQuestion] = useState("");
  const [persona, setPersona] = useState("");
  const [language, setLanguage] = useState("English");
  const [answer, setAnswer] = useState("");
  const [modelUsed, setModelUsed] = useState("");
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [ttsLoading, setTtsLoading] = useState(false);
  const [ttsPlaying, setTtsPlaying] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [errorScope, setErrorScope] = useState<ErrorScope>("");

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<any>(null);
  const mediaPreviewRef = useRef<string | null>(null);
  const audioCacheKeyRef = useRef<string>("");

  const personaMeta = PERSONAS.find((p) => p.value === persona) ?? PERSONAS[0];
  const forceAutoSpeak = persona === "visually impaired person";
  const willAutoSpeak = forceAutoSpeak || autoSpeak;
  const canAsk = Boolean(media && question.trim() && !loading && !cameraOpen);

  useEffect(() => {
    return () => {
      stopCamera();
      if (mediaPreviewRef.current) URL.revokeObjectURL(mediaPreviewRef.current);
      recognitionRef.current?.stop?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setScopedError(scope: ErrorScope, message: string) {
    setErrorScope(scope);
    setError(message);
  }

  function clearError() {
    setError("");
    setErrorScope("");
  }

  async function applyMedia(blob: Blob, mimeType: string, label: string) {
    if (blob.size > MAX_FILE_BYTES) {
      setScopedError(
        "media",
        `File is ${formatBytes(blob.size)}. Keep under ${formatBytes(MAX_FILE_BYTES)} — try a shorter clip or a still photo.`
      );
      return;
    }
    if (!mimeType || (!mimeType.startsWith("image/") && !mimeType.startsWith("video/"))) {
      setScopedError("media", "Use an image or video file.");
      return;
    }

    const base64 = await fileToBase64(blob);
    if (mediaPreviewRef.current) URL.revokeObjectURL(mediaPreviewRef.current);
    const previewUrl = URL.createObjectURL(blob);
    mediaPreviewRef.current = previewUrl;

    setMedia({
      base64,
      mimeType,
      previewUrl,
      label,
      sizeLabel: `${formatBytes(blob.size)} · ${mimeType}`,
    });
    setAnswer("");
    setModelUsed("");
    clearError();
    setStatus("");
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    await applyMedia(file, file.type, file.name || "Uploaded media");
  }

  async function onFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    await handleFile(e.target.files?.[0]);
    e.target.value = "";
  }

  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    await handleFile(e.dataTransfer.files?.[0]);
  }

  async function openCamera() {
    clearError();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOpen(true);
      setStatus("Camera ready — capture a still");
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
      });
    } catch {
      setScopedError(
        "media",
        "Camera access was denied or unavailable. Check permissions, or upload a file instead."
      );
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOpen(false);
  }

  async function captureStill() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.92)
    );
    stopCamera();
    if (!blob) {
      setScopedError("media", "Couldn't capture that frame. Try again.");
      return;
    }
    await applyMedia(blob, "image/jpeg", "Camera capture");
    setStatus("Photo captured");
  }

  function clearMedia() {
    if (mediaPreviewRef.current) {
      URL.revokeObjectURL(mediaPreviewRef.current);
      mediaPreviewRef.current = null;
    }
    setMedia(null);
    setAnswer("");
    setModelUsed("");
    setStatus("");
  }

  function startListening() {
    clearError();
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setScopedError(
        "mic",
        "Speech recognition isn't supported here — try Chrome or Edge, or type your question."
      );
      return;
    }

    if (listening && recognitionRef.current) {
      recognitionRef.current.stop();
      return;
    }

    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;
    recognition.lang = LANGUAGES[language] || "en-IN";
    recognition.interimResults = true;
    recognition.continuous = false;

    recognition.onstart = () => {
      setListening(true);
      setStatus("Listening…");
    };
    recognition.onerror = () => {
      setListening(false);
      setStatus("");
      setScopedError("mic", "Couldn't hear that. Tap the mic and try again.");
    };
    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
      if (!question) setStatus("");
    };
    recognition.onresult = (e: any) => {
      let transcript = "";
      for (let i = 0; i < e.results.length; i++) {
        transcript += e.results[i][0].transcript;
      }
      setQuestion(transcript.trim());
      if (e.results[e.results.length - 1]?.isFinal) {
        setStatus("Heard your question");
      }
    };
    recognition.start();
  }

  function audioKey(text: string) {
    return `${language}::${text}`;
  }

  function resetAudio() {
    const el = audioRef.current;
    if (el) {
      el.pause();
      el.removeAttribute("src");
      el.load();
    }
    audioCacheKeyRef.current = "";
    setAudioReady(false);
    setTtsPlaying(false);
    setTtsLoading(false);
  }

  async function ensureAudio(text: string) {
    const key = audioKey(text);
    if (audioReady && audioCacheKeyRef.current === key && audioRef.current?.src) {
      return true;
    }

    clearError();
    setTtsLoading(true);
    setStatus("Generating speech…");
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);
      const res = await fetch("/api/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: markdownToSpeech(text),
          languageCode: LANGUAGES[language],
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "TTS failed");
      if (!data.audioBase64) throw new Error("No audio returned");
      if (!audioRef.current) return false;

      audioRef.current.src = `data:audio/wav;base64,${data.audioBase64}`;
      audioCacheKeyRef.current = key;
      setAudioReady(true);
      setTtsLoading(false);
      return true;
    } catch (err: any) {
      setTtsLoading(false);
      setTtsPlaying(false);
      setStatus("");
      setScopedError(
        "tts",
        err.name === "AbortError"
          ? "Speech timed out — try Play again."
          : typeof err.message === "string"
            ? err.message
            : "Couldn't play audio."
      );
      return false;
    }
  }

  async function playAudio(text: string) {
    const ready = await ensureAudio(text);
    if (!ready || !audioRef.current) return;
    try {
      setTtsPlaying(true);
      setStatus("Speaking…");
      await audioRef.current.play();
    } catch {
      setTtsPlaying(false);
      setStatus("");
      setScopedError("tts", "Couldn't start playback.");
    }
  }

  function pauseAudio() {
    audioRef.current?.pause();
    setTtsPlaying(false);
    setStatus("Paused");
  }

  async function toggleAudio(text: string) {
    if (ttsLoading) return;
    if (ttsPlaying) {
      pauseAudio();
      return;
    }
    // Resume if same clip already loaded
    const el = audioRef.current;
    const key = audioKey(text);
    if (audioReady && audioCacheKeyRef.current === key && el?.src) {
      try {
        setTtsPlaying(true);
        setStatus("Speaking…");
        await el.play();
      } catch {
        setTtsPlaying(false);
        setStatus("");
        setScopedError("tts", "Couldn't start playback.");
      }
      return;
    }
    await playAudio(text);
  }

  async function ask() {
    if (!media || !question.trim()) return;
    setLoading(true);
    clearError();
    setAnswer("");
    setModelUsed("");
    setStatus("Understanding…");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 55_000);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mediaBase64: media.base64,
          mimeType: media.mimeType,
          question: question.trim(),
          persona,
          language,
        }),
        signal: controller.signal,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      resetAudio();
      setAnswer(data.answer);
      setModelUsed(data.model || "");
      setStatus("");

      if (willAutoSpeak && data.answer) {
        void playAudio(data.answer);
      }
    } catch (err: any) {
      setStatus("");
      setScopedError(
        "ask",
        err.name === "AbortError"
          ? "Timed out after 55s — try a smaller image or a simpler question."
          : err.message
      );
    } finally {
      clearTimeout(timeout);
      setLoading(false);
    }
  }

  return (
    <div className="app-shell">
      <div className="mx-auto flex min-h-dvh max-w-6xl flex-col px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <header className="mb-5 flex items-baseline justify-between gap-4 lg:mb-6">
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            Visualingo
          </h1>
          {status && (
            <p className="text-sm text-sea tabular-nums" aria-live="polite">
              {status}
            </p>
          )}
        </header>

        <div className="grid flex-1 gap-6 lg:grid-cols-[1.35fr_1fr] lg:gap-8 lg:items-start">
          {/* Media stage */}
          <section
            className="relative flex min-h-[280px] flex-col overflow-hidden rounded-2xl bg-fog sm:min-h-[360px] lg:min-h-[520px]"
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
          >
            {cameraOpen ? (
              <div className="relative flex flex-1 flex-col">
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  className="absolute inset-0 h-full w-full object-cover"
                />
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-3 bg-gradient-to-t from-ink/70 to-transparent p-5">
                  <button
                    type="button"
                    onClick={stopCamera}
                    className="rounded-full bg-fog/90 px-4 py-2 text-sm text-ink"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={captureStill}
                    className="h-14 w-14 rounded-full border-4 border-fog bg-coral shadow-lg"
                    aria-label="Capture photo"
                  />
                </div>
              </div>
            ) : media ? (
              <div className="relative flex flex-1 animate-media-in">
                {media.mimeType.startsWith("image/") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={media.previewUrl}
                    alt="Selected media"
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                ) : (
                  <video
                    src={media.previewUrl}
                    controls
                    className="absolute inset-0 h-full w-full object-contain bg-ink"
                  />
                )}
                <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-end justify-between gap-3 bg-gradient-to-t from-ink/75 to-transparent p-4">
                  <div className="min-w-0 text-fog">
                    <p className="truncate text-sm font-medium">{media.label}</p>
                    <p className="text-xs opacity-80">{media.sizeLabel}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="rounded-full bg-fog/95 px-3 py-1.5 text-sm text-ink"
                    >
                      Change
                    </button>
                    <button
                      type="button"
                      onClick={clearMedia}
                      className="rounded-full bg-fog/95 px-3 py-1.5 text-sm text-ink"
                    >
                      Clear
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-1 flex-col items-start justify-center gap-6 p-8 sm:p-10">
                <div>
                  <p className="font-display text-4xl font-semibold leading-tight text-ink sm:text-5xl">
                    Visualingo
                  </p>
                  <p className="mt-3 max-w-sm text-base text-ink/70">
                    See it. Ask it. Hear it in your language.
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-fog"
                  >
                    Upload
                  </button>
                  <button
                    type="button"
                    onClick={openCamera}
                    className="rounded-full border border-ink/20 bg-transparent px-5 py-2.5 text-sm font-medium text-ink"
                  >
                    Use camera
                  </button>
                </div>
                <p className="text-xs text-ink/50">
                  Drop an image or video here · under {formatBytes(MAX_FILE_BYTES)}
                </p>
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              onChange={onFileInput}
              className="hidden"
            />
          </section>

          {/* Ask rail */}
          <section className="flex flex-col gap-5">
            <div>
              <p className="mb-2 text-sm text-ink/60">For whom</p>
              <div className="flex flex-wrap gap-2">
                {PERSONAS.map((p) => {
                  const active = persona === p.value;
                  return (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => setPersona(p.value)}
                      className={`rounded-full px-3 py-1.5 text-sm transition-colors ${
                        active
                          ? "bg-sea text-fog"
                          : "bg-fog text-ink hover:bg-sea/15"
                      }`}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-ink/50">{personaMeta.hint}</p>
            </div>

            <div className="flex flex-wrap items-end gap-4">
              <label className="flex min-w-[10rem] flex-1 flex-col gap-1.5 text-sm">
                <span className="text-ink/60">Language</span>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="rounded-xl border border-ink/15 bg-fog px-3 py-2 text-ink outline-none focus:border-sea"
                >
                  {Object.keys(LANGUAGES).map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex items-center gap-2 pb-2 text-sm text-ink/70">
                <input
                  type="checkbox"
                  checked={willAutoSpeak}
                  disabled={forceAutoSpeak}
                  onChange={(e) => setAutoSpeak(e.target.checked)}
                  className="accent-sea"
                />
                Auto-speak
                {forceAutoSpeak && (
                  <span className="text-xs text-ink/45">(on for this persona)</span>
                )}
              </label>
            </div>

            <div>
              <p className="mb-2 text-sm text-ink/60">Quick ask</p>
              <div className="flex flex-wrap gap-2">
                {QUICK_PROMPTS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setQuestion(q)}
                    className="rounded-full border border-ink/10 bg-fog px-3 py-1 text-xs text-ink/80 hover:border-sea/40"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canAsk) void ask();
                }}
                placeholder="Ask a question about the media…"
                className="flex-1 rounded-xl border border-ink/15 bg-fog px-3 py-2.5 text-sm text-ink outline-none placeholder:text-ink/35 focus:border-sea"
              />
              <button
                type="button"
                onClick={startListening}
                className={`rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors ${
                  listening
                    ? "animate-pulse-listen bg-coral text-fog"
                    : "border border-ink/15 bg-fog text-ink"
                }`}
                aria-pressed={listening}
                aria-label={listening ? "Stop listening" : "Speak question"}
              >
                {listening ? "Stop" : "Mic"}
              </button>
            </div>

            <button
              type="button"
              onClick={ask}
              disabled={!canAsk}
              className="rounded-xl bg-ink px-4 py-3 text-sm font-medium text-fog disabled:cursor-not-allowed disabled:opacity-35"
            >
              {loading ? "Understanding…" : "Ask"}
            </button>

            {!media && !error && (
              <p className="text-xs text-ink/45">Upload or capture something first.</p>
            )}
            {media && !question.trim() && !error && (
              <p className="text-xs text-ink/45">Type a question, use a quick ask, or tap Mic.</p>
            )}

            {error && (
              <p
                className="rounded-xl border border-coral/30 bg-coral/10 px-3 py-2 text-sm text-ink"
                role="alert"
              >
                {errorScope === "tts" ? "Audio: " : ""}
                {error}
              </p>
            )}

            {answer && (
              <div className="animate-fade-in-answer flex flex-col gap-3 border-t border-ink/10 pt-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-ink/60">Answer</p>
                  <div className="flex flex-wrap gap-2 text-xs text-ink/45">
                    <span>{personaMeta.label}</span>
                    <span>·</span>
                    <span>{language}</span>
                    {modelUsed && (
                      <>
                        <span>·</span>
                        <span>via {modelUsed.replace(/^gemini-/, "")}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="answer-md text-sm leading-relaxed text-ink">
                  <ReactMarkdown>{answer}</ReactMarkdown>
                </div>
                <button
                  type="button"
                  onClick={() => void toggleAudio(answer)}
                  disabled={ttsLoading}
                  className={`self-start rounded-full px-4 py-2 text-sm disabled:opacity-50 ${
                    ttsPlaying
                      ? "bg-coral text-fog"
                      : "border border-ink/15 bg-fog text-ink"
                  }`}
                  aria-label={ttsPlaying ? "Pause audio" : "Play audio"}
                >
                  {ttsLoading
                    ? "Generating speech…"
                    : ttsPlaying
                      ? "Pause"
                      : audioReady
                        ? "Play"
                        : "Play audio"}
                </button>
              </div>
            )}

            <audio
              ref={audioRef}
              className="hidden"
              onPlay={() => {
                setTtsPlaying(true);
                setStatus("Speaking…");
              }}
              onPause={() => {
                // onPause also fires on ended — only mark paused if not finished
                const el = audioRef.current;
                if (el && !el.ended) {
                  setTtsPlaying(false);
                  setStatus("Paused");
                }
              }}
              onEnded={() => {
                setTtsPlaying(false);
                setStatus("");
                if (audioRef.current) audioRef.current.currentTime = 0;
              }}
            />
          </section>
        </div>
      </div>
    </div>
  );
}

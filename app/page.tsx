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
      <header className="app-header">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3 sm:gap-4">
            <EyeLogo className="h-11 w-14 shrink-0 sm:h-14 sm:w-[4.5rem]" />
            <div>
              <h1 className="font-display text-3xl font-bold leading-none sm:text-[2.6rem]">
                <span className="text-navy">Visual</span>{" "}
                <span className="text-primary">Lingo</span>
              </h1>
              <p className="mt-1.5 text-sm text-muted sm:text-base">
                See <span className="mx-1.5 opacity-60">•</span> Understand{" "}
                <span className="mx-1.5 opacity-60">•</span> Connect
              </p>
            </div>
          </div>
          {status && (
            <p
              className="flex items-center gap-2 rounded-xl border border-line bg-white px-3.5 py-2 text-sm font-medium text-primary shadow-sm tabular-nums"
              aria-live="polite"
            >
              <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
              {status}
            </p>
          )}
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
        {/* Hero */}
        <section className="hero-banner flex items-center justify-between gap-6 overflow-hidden rounded-2xl px-6 py-6 sm:px-9 sm:py-7">
          <div className="max-w-xl">
            <h2 className="font-display text-2xl font-bold leading-tight text-navy sm:text-[2.1rem]">
              Turn Visuals into Voices
              <br />
              in Your Language
            </h2>
            <p className="mt-3 text-base leading-relaxed text-navy/80 sm:text-lg">
              Upload an image or video, choose your preferences, and get audio and text
              descriptions in multiple languages.
            </p>
          </div>
          <HeroArt className="hidden h-40 w-auto shrink-0 md:block lg:h-44" />
        </section>

        <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
          {/* Media stage */}
          <section
            className="panel flex flex-col p-5 sm:p-6"
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
          >
            <div className="mb-5 flex items-start gap-4">
              <CloudIcon className="mt-0.5 h-11 w-11 shrink-0 text-primary" />
              <div>
                <h3 className="text-2xl font-bold text-navy">Upload Media</h3>
                <p className="mt-1 text-base text-muted">
                  Choose an image or video to get started.
                </p>
              </div>
            </div>

            {cameraOpen ? (
              <div className="relative min-h-[320px] flex-1 overflow-hidden rounded-xl bg-navy sm:min-h-[420px]">
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  className="absolute inset-0 h-full w-full object-cover"
                />
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-3 bg-gradient-to-t from-navy/70 to-transparent p-5">
                  <button
                    type="button"
                    onClick={stopCamera}
                    className="rounded-full bg-white/95 px-4 py-2 text-sm font-medium text-navy"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={captureStill}
                    className="h-14 w-14 rounded-full border-4 border-white bg-primary shadow-lg"
                    aria-label="Capture photo"
                  />
                </div>
              </div>
            ) : media ? (
              <div className="relative min-h-[320px] flex-1 animate-media-in overflow-hidden rounded-xl border border-line bg-navy sm:min-h-[420px]">
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
                    className="absolute inset-0 h-full w-full object-contain bg-navy"
                  />
                )}
                <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-end justify-between gap-3 bg-gradient-to-t from-navy/80 to-transparent p-4">
                  <div className="min-w-0 text-white">
                    <p className="truncate text-sm font-semibold">{media.label}</p>
                    <p className="text-xs opacity-80">{media.sizeLabel}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="rounded-full bg-white/95 px-3.5 py-1.5 text-sm font-medium text-navy"
                    >
                      Change
                    </button>
                    <button
                      type="button"
                      onClick={clearMedia}
                      className="rounded-full bg-white/95 px-3.5 py-1.5 text-sm font-medium text-navy"
                    >
                      Clear
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-5">
                <div className="grid grid-cols-2 gap-4">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex flex-col items-center gap-2 rounded-lg border-[1.5px] border-[#7fb3ea] bg-gradient-to-b from-[#f2f8ff] to-[#e9f3fe] px-3 py-7 text-center transition hover:shadow-md sm:py-9"
                  >
                    <ImageIcon className="mb-2 h-14 w-16" />
                    <span className="text-lg font-bold text-navy">Upload</span>
                    <span className="text-sm text-muted">Image or video</span>
                  </button>
                  <button
                    type="button"
                    onClick={openCamera}
                    className="flex flex-col items-center gap-2 rounded-lg border-[1.5px] border-[#a99bf0] bg-gradient-to-b from-[#f6f4ff] to-[#efecfe] px-3 py-7 text-center transition hover:shadow-md sm:py-9"
                  >
                    <CameraIcon className="mb-2 h-14 w-16" />
                    <span className="text-lg font-bold text-navy">Use camera</span>
                    <span className="text-sm text-muted">Capture a still photo</span>
                  </button>
                </div>
                <div className="dropzone flex flex-col items-center gap-2 px-4 py-7 text-center">
                  <UploadCloudIcon className="h-12 w-16 text-[#6b7fb5]" />
                  <p className="mt-1 text-base text-[#3e4c6e]">Drag &amp; drop your file here</p>
                  <p className="text-sm text-muted">or</p>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="btn-primary mt-1 rounded-full px-9 py-2.5 text-base font-semibold"
                  >
                    Browse Files
                  </button>
                  <p className="mt-2 text-xs text-muted/80">
                    Images or videos · under {formatBytes(MAX_FILE_BYTES)}
                  </p>
                </div>
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
          <section className="panel flex flex-col gap-1 p-3.5 sm:p-4">
            <RailSection
              icon={<PeopleIcon className="h-6 w-6 text-[#5b4fd6]" />}
              title="Select For Whom?"
              hint={`Choose the target audience. ${personaMeta.hint}.`}
            >
              <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-5">
                {PERSONAS.map((p) => {
                  const active = persona === p.value;
                  const s = PERSONA_STYLE[p.label];
                  return (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => setPersona(p.value)}
                      aria-pressed={active}
                      className={`flex min-h-[5.25rem] flex-col items-center justify-center gap-1.5 rounded-lg border px-1.5 py-2.5 text-center text-sm leading-tight text-navy transition ${s.box} ${
                        active
                          ? "ring-2 ring-primary ring-offset-1 font-semibold shadow-sm"
                          : "hover:shadow-sm"
                      }`}
                    >
                      <span className={s.icon}>{s.glyph}</span>
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </RailSection>

            <RailSection
              icon={<GlobeIcon className="h-6 w-6 text-primary" />}
              title="Select Language"
              hint="Choose the language for audio and text output."
            >
              <div className="flex flex-wrap items-center gap-4">
                <div className="field relative min-w-[10rem] flex-1">
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    className="w-full appearance-none bg-transparent px-3 py-2.5 pr-9 text-sm text-navy outline-none"
                    aria-label="Language"
                  >
                    {Object.keys(LANGUAGES).map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                  <ChevronIcon className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-navy/70" />
                </div>
              </div>
            </RailSection>

            <RailSection
              icon={<SpeakerIcon className="h-6 w-6 text-ok" />}
              title="Audio Output"
              hint="Read the answer aloud as soon as it arrives."
              tint="green"
            >
              <label className="field flex cursor-pointer items-center gap-2.5 px-3 py-2.5 text-sm text-navy">
                <input
                  type="checkbox"
                  checked={willAutoSpeak}
                  disabled={forceAutoSpeak}
                  onChange={(e) => setAutoSpeak(e.target.checked)}
                  className="h-4 w-4 accent-primary"
                />
                Auto-speak
                {forceAutoSpeak && (
                  <span className="text-xs text-muted">(on for this persona)</span>
                )}
              </label>
            </RailSection>

            <RailSection
              icon={<DocIcon className="h-6 w-6 text-[#5b5fe0]" />}
              title="Ask a Question"
              hint="Type, pick a quick ask, or speak with the mic."
            >
              <div className="mb-2.5 flex flex-wrap gap-2">
                {QUICK_PROMPTS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setQuestion(q)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                      question === q
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-line bg-white text-[#3e4c6e] hover:border-primary/50"
                    }`}
                  >
                    {q}
                  </button>
                ))}
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
                  className="field flex-1 px-3 py-2.5 text-sm text-navy placeholder:text-muted/70"
                />
                <button
                  type="button"
                  onClick={startListening}
                  className={`flex items-center gap-1.5 rounded-lg px-3.5 py-2.5 text-sm font-medium transition-colors ${
                    listening
                      ? "animate-pulse-listen bg-coral text-white"
                      : "field text-navy hover:border-primary"
                  }`}
                  aria-pressed={listening}
                  aria-label={listening ? "Stop listening" : "Speak question"}
                >
                  <MicIcon className="h-4 w-4" />
                  {listening ? "Stop" : "Mic"}
                </button>
              </div>
            </RailSection>

            <div className="px-1 pt-2 sm:px-1.5">
              <button
                type="button"
                onClick={ask}
                disabled={!canAsk}
                className="btn-primary flex w-full items-center justify-center gap-2.5 rounded-lg px-4 py-3.5 text-lg font-semibold disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none"
              >
                <SparkleIcon className="h-5 w-5" />
                {loading ? "Understanding…" : "Generate"}
              </button>

              {!media && !error && (
                <p className="mt-2.5 text-center text-xs text-muted">
                  Upload or capture something first.
                </p>
              )}
              {media && !question.trim() && !error && (
                <p className="mt-2.5 text-center text-xs text-muted">
                  Type a question, use a quick ask, or tap Mic.
                </p>
              )}

              {error && (
                <p
                  className="mt-3 rounded-lg border border-coral/30 bg-coral/10 px-3 py-2 text-sm text-navy"
                  role="alert"
                >
                  {errorScope === "tts" ? "Audio: " : ""}
                  {error}
                </p>
              )}

              {answer && (
                <div className="animate-fade-in-answer mt-4 flex flex-col gap-3 rounded-xl border border-line bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-base font-bold text-navy">Answer</p>
                    <div className="flex flex-wrap gap-1.5 text-xs">
                      <span className="rounded-full bg-tint px-2 py-0.5 text-primary">
                        {personaMeta.label}
                      </span>
                      <span className="rounded-full bg-tint px-2 py-0.5 text-primary">
                        {language}
                      </span>
                      {modelUsed && (
                        <span className="rounded-full bg-tint px-2 py-0.5 text-muted">
                          via {modelUsed.replace(/^gemini-/, "")}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="answer-md text-sm leading-relaxed text-[#2a3a5e]">
                    <ReactMarkdown>{answer}</ReactMarkdown>
                  </div>
                  <button
                    type="button"
                    onClick={() => void toggleAudio(answer)}
                    disabled={ttsLoading}
                    className={`flex items-center gap-2 self-start rounded-full px-4 py-2 text-sm font-medium disabled:opacity-50 ${
                      ttsPlaying ? "btn-primary" : "field text-navy hover:border-primary"
                    }`}
                    aria-label={ttsPlaying ? "Pause audio" : "Play audio"}
                  >
                    <SpeakerIcon className="h-4 w-4" />
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
            </div>

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

const SECTION_TINT = {
  blue: "from-[#e9f0fd] to-[#f3f7fe]/40",
  green: "from-[#e6f6ee] to-[#f2fbf6]/40",
};

function RailSection({
  icon,
  title,
  hint,
  tint = "blue",
  children,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  tint?: keyof typeof SECTION_TINT;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3 border-b border-line/70 px-1 py-3.5 last-of-type:border-b-0 sm:px-1.5">
      <div
        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg ${
          tint === "green" ? "bg-[#e6f6ee]" : "bg-[#eaf0fd]"
        }`}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className={`rounded-md bg-gradient-to-r ${SECTION_TINT[tint]} px-3 py-2`}>
          <h3 className="text-base font-bold text-navy">{title}</h3>
        </div>
        <p className="mb-3 mt-1.5 px-3 text-[13px] text-[#4a5878]">{hint}</p>
        <div className="px-0 sm:pl-0">{children}</div>
      </div>
    </div>
  );
}

type IconProps = { className?: string };

const PERSONA_STYLE: Record<string, { box: string; icon: string; glyph: React.ReactNode }> = {
  Default: {
    box: "border-[#cfdcf3] bg-[#f1f5fd]",
    icon: "text-[#4361e8]",
    glyph: <SparkleIcon className="h-6 w-6" />,
  },
  Child: {
    box: "border-[#f5e0b3] bg-[#fef8ea]",
    icon: "text-[#f0a73a]",
    glyph: <SmileIcon className="h-6 w-6" />,
  },
  Student: {
    box: "border-[#c9dcf5] bg-[#ecf4fe]",
    icon: "text-[#2d5fb8]",
    glyph: <CapIcon className="h-6 w-6" />,
  },
  Tourist: {
    box: "border-[#c8e9d6] bg-[#ecf8f1]",
    icon: "text-[#2fa36b]",
    glyph: <PinIcon className="h-6 w-6" />,
  },
  "Visually impaired": {
    box: "border-[#f5cfe0] bg-[#fdeff5]",
    icon: "text-[#7b5ad6]",
    glyph: <EyeIcon className="h-6 w-6" />,
  },
};

function EyeLogo({ className }: IconProps) {
  return (
    <svg viewBox="0 0 72 56" className={className} aria-hidden>
      <g stroke="#4361e8" strokeWidth="3" strokeLinecap="round">
        <line x1="36" y1="3" x2="36" y2="10" />
        <line x1="22" y1="7" x2="25" y2="13" />
        <line x1="50" y1="7" x2="47" y2="13" />
        <line x1="10" y1="14" x2="15" y2="18" />
        <line x1="62" y1="14" x2="57" y2="18" />
      </g>
      <path
        d="M4 36 C 16 18, 56 18, 68 36 C 56 54, 16 54, 4 36 Z"
        fill="#fff"
        stroke="#4361e8"
        strokeWidth="3.5"
        strokeLinejoin="round"
      />
      <circle cx="36" cy="36" r="12" fill="#4361e8" />
      <circle cx="36" cy="36" r="6.5" fill="#fff" />
      <circle cx="36" cy="36" r="3.5" fill="#2a49d0" />
    </svg>
  );
}

function HeroArt({ className }: IconProps) {
  return (
    <svg viewBox="0 0 700 190" className={className} aria-hidden>
      <defs>
        <linearGradient id="hImg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#bfe0fb" />
          <stop offset="1" stopColor="#d9eefd" />
        </linearGradient>
        <linearGradient id="hVid" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8f8af5" />
          <stop offset="1" stopColor="#6b5fe6" />
        </linearGradient>
        <linearGradient id="hBubble" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4c9bf5" />
          <stop offset="1" stopColor="#3a86ee" />
        </linearGradient>
      </defs>
      {/* leaves */}
      <path d="M20 150 C 0 110, 20 80, 40 70 C 45 100, 40 130, 20 150 Z" fill="#cfe3fb" />
      <path d="M560 150 C 600 120, 650 120, 680 140 C 650 160, 600 165, 560 150 Z" fill="#d6e8fc" />
      <circle cx="660" cy="50" r="22" fill="#dce9fd" />
      {/* image card */}
      <rect x="50" y="25" width="135" height="120" rx="10" fill="#7cb8f0" />
      <rect x="57" y="32" width="121" height="106" rx="6" fill="url(#hImg)" />
      <circle cx="140" cy="60" r="10" fill="#f9c74f" />
      <path d="M57 125 L95 78 L125 110 L145 92 L178 125 V138 H57 Z" fill="#4aa3e8" />
      <path d="M95 125 L135 88 L178 125 V138 H95 Z" fill="#6dd3cf" opacity="0.85" />
      {/* video card */}
      <rect x="170" y="75" width="125" height="92" rx="10" fill="url(#hVid)" />
      <rect x="170" y="75" width="125" height="18" rx="9" fill="#a6a2f8" />
      <circle cx="185" cy="84" r="3" fill="#fff" />
      <rect x="191" y="82.5" width="10" height="3" rx="1.5" fill="#fff" />
      <path d="M222 108 L250 124 L222 140 Z" fill="none" stroke="#fff" strokeWidth="6" strokeLinejoin="round" />
      {/* arrow */}
      <path d="M318 115 C 335 95, 355 92, 372 98" fill="none" stroke="#4361e8" strokeWidth="3" strokeLinecap="round" />
      <path d="M362 90 L374 98 L363 107" fill="none" stroke="#4361e8" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      {/* speech bubble */}
      <rect x="395" y="55" width="185" height="92" rx="20" fill="url(#hBubble)" />
      <path d="M455 145 L455 172 L480 145 Z" fill="#3a86ee" />
      <path d="M420 88 H432 L447 76 V126 L432 114 H420 Z" fill="#fff" />
      <path d="M455 88 Q 463 101 455 114" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" />
      <g stroke="#fff" strokeWidth="4" strokeLinecap="round">
        <line x1="482" y1="94" x2="482" y2="108" />
        <line x1="494" y1="84" x2="494" y2="118" />
        <line x1="506" y1="90" x2="506" y2="112" />
        <line x1="518" y1="78" x2="518" y2="124" />
        <line x1="530" y1="88" x2="530" y2="114" />
        <line x1="542" y1="94" x2="542" y2="108" />
        <line x1="554" y1="86" x2="554" y2="116" />
      </g>
      {/* language badges */}
      <rect x="490" y="8" width="44" height="40" rx="8" fill="#3a86ee" />
      <path d="M507 50 L512 56 L517 50 Z" fill="#3a86ee" />
      <text x="512" y="38" textAnchor="middle" fontSize="26" fontWeight="600" fill="#fff" fontFamily="system-ui">A</text>
      <rect x="585" y="28" width="40" height="38" rx="8" fill="#fde7b0" />
      <text x="605" y="55" textAnchor="middle" fontSize="20" fontWeight="600" fill="#c98a12" fontFamily="system-ui">अ</text>
      <rect x="605" y="90" width="44" height="42" rx="8" fill="#49c39a" />
      <text x="627" y="120" textAnchor="middle" fontSize="24" fontWeight="600" fill="#fff" fontFamily="system-ui">文</text>
    </svg>
  );
}

function CloudIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M14 34h-2a9 9 0 0 1-1-17.9A12 12 0 0 1 34.3 14 9 9 0 0 1 37 34h-3" />
      <path d="M24 40V24M18 30l6-6 6 6" />
    </svg>
  );
}

function UploadCloudIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 64 48" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M20 36h-6a11 11 0 0 1-1-21.9A15 15 0 0 1 42 12a11 11 0 0 1 8 24h-6" />
      <path d="M32 46V24M25 31l7-7 7 7" />
    </svg>
  );
}

function ImageIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 64 56" className={className} aria-hidden>
      <rect x="2" y="2" width="60" height="52" rx="8" fill="#4ba3ef" />
      <rect x="7" y="7" width="50" height="42" rx="4" fill="#d9eefd" />
      <circle cx="19" cy="18" r="5" fill="#f9c74f" />
      <path d="M7 44 L24 25 L36 38 L44 30 L57 43 V49 H7 Z" fill="#4ba3ef" />
    </svg>
  );
}

function CameraIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 64 56" className={className} aria-hidden>
      <rect x="2" y="2" width="60" height="52" rx="8" fill="#8073ef" />
      <rect x="6" y="6" width="52" height="44" rx="5" fill="#f1effe" />
      <path d="M18 20h6l3-5h10l3 5h6a3 3 0 0 1 3 3v17a3 3 0 0 1-3 3H18a3 3 0 0 1-3-3V23a3 3 0 0 1 3-3z" fill="#8073ef" />
      <circle cx="32" cy="31" r="7" fill="#f1effe" />
      <circle cx="32" cy="31" r="4" fill="#8073ef" />
    </svg>
  );
}

function GlobeIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M2.5 12h19M12 2.5c2.8 3 2.8 16 0 19M12 2.5c-2.8 3-2.8 16 0 19M4 7h16M4 17h16" />
    </svg>
  );
}

function PeopleIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <circle cx="9" cy="7.5" r="3.5" />
      <path d="M2 19.5c0-3.6 3.1-6 7-6s7 2.4 7 6v.5H2z" />
      <circle cx="17" cy="8.5" r="2.8" opacity="0.6" />
      <path d="M17 13c3 0 5 1.9 5 4.8v.7h-4.5c0-2.2-.8-4-2.3-5.3.6-.1 1.2-.2 1.8-.2z" opacity="0.6" />
    </svg>
  );
}

function SpeakerIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
      <path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" />
    </svg>
  );
}

function DocIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path d="M6 2h8l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="currentColor" />
      <path d="M8 11h8M8 14.5h8M8 18h5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function ChevronIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function MicIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

function SparkleIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M10 3l1.8 5.2L17 10l-5.2 1.8L10 17l-1.8-5.2L3 10l5.2-1.8z" />
      <path d="M18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8z" />
    </svg>
  );
}

function SmileIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className={className} aria-hidden>
      <circle cx="12" cy="12" r="9" fill="#ffe2b8" />
      <circle cx="9" cy="10.5" r="0.9" fill="currentColor" />
      <circle cx="15" cy="10.5" r="0.9" fill="currentColor" />
      <path d="M8.5 14.5c1.8 2 5.2 2 7 0" />
    </svg>
  );
}

function CapIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M2 9l10-5 10 5-10 5z" fill="currentColor" />
      <path d="M6 11.5V16c0 1.5 2.7 3 6 3s6-1.5 6-3v-4.5" />
    </svg>
  );
}

function PinIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7z" fill="currentColor" />
      <circle cx="12" cy="9" r="2.6" fill="#fff" />
    </svg>
  );
}

function EyeIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
      <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" />
      <circle cx="12" cy="12" r="3.2" fill="currentColor" />
    </svg>
  );
}

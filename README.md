# Visualingo

Minimal multimodal VQA app: upload an image or video, ask a question (typed or
spoken), get an answer — optionally personalized and translated — with audio
playback.

## Stack

- **Next.js** — frontend + API routes, one app
- **Gemini API** — image/video understanding, VQA, translation (one call covers all of it)
- **Sarvam API** — text-to-speech for Indian languages
- **Browser SpeechRecognition** — speech-to-text (Chrome/Edge), no backend needed

## Setup

1. `.env` already has `GEMINI_API_KEY` and `SARWAM_API_KEY` — keep it out of git (already gitignored).
2. `npm run dev`
3. Open http://localhost:3000

## Scope

This is intentionally minimal for a college project — one API call per feature,
no fine-tuning, no custom models, no database. Hallucination verification and
conversational multi-turn memory are not implemented; see the draft paper for
what a fuller version would add.

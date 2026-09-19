# Visualingo

**A Multimodal Vision-Language Framework for Image and Video Understanding, Conversational Visual Question Answering, Personalized Explanation, Multilingual Communication, and Audio-Based Interaction**

Visualingo lets a user upload an image or video (or capture one live), ask a
question about it by typing or speaking, and receive an answer that is
personalized to who they are and delivered in their preferred language — as
text and as speech.

## Problem

Existing vision-language systems (image captioning, VQA, translation, speech
synthesis) are built as isolated tools. A user who wants to point a camera at
something, ask a question out loud, get an explanation pitched at their level,
and hear the answer back in their own language has to stitch several separate
tools together — and still gets generic, one-size-fits-all descriptions with
no personalization or multilingual reach.

## Objectives

1. Understand uploaded images, live camera captures, and video.
2. Generate detailed, context-aware descriptions of visual content.
3. Support Visual Question Answering (VQA) with text and audio input/output.
4. Provide personalized explanations based on the user's profile (child,
   student, tourist, visually impaired).
5. Translate answers across multiple Indian languages.
6. Accept spoken questions (speech-to-text) and speak answers back
   (text-to-speech).
7. Do all of the above through one unified interface, not separate tools.

## Architecture

The draft paper's flow diagram calls for a long pipeline: vision encoder →
VLM → captioning/object detection/scene understanding → contextual reasoning
→ VQA → personalization → translation → TTS. Visualingo implements that same
pipeline, collapsed onto two API providers instead of one custom model per
stage:

```
┌──────────────────────────┐
│   USER INPUT              │
│   image / video upload,   │
│   camera capture, voice   │
└─────────────┬─────────────┘
              │
              ▼
┌──────────────────────────┐
│  Speech-to-Text            │   Browser-native Web Speech API
│  (spoken questions)        │   (client-side, no server round trip)
└─────────────┬─────────────┘
              │
              ▼
┌──────────────────────────┐
│  Vision + Language Model   │   Gemini API (multimodal)
│  — encodes the image/video │   One call replaces vision encoder + VLM +
│  — captions, detects       │   caption/object/scene modules + contextual
│    objects, reasons about  │   reasoning + VQA from the original diagram
│    the scene               │
│  — answers the question    │
└─────────────┬─────────────┘
              │
              ▼
┌──────────────────────────┐
│  Personalization            │   A persona instruction (child / student /
│  + Translation               │   tourist / visually impaired) and a target
│                              │   language are folded into the same Gemini
│                              │   prompt — answer is generated already
│                              │   tailored and already translated
└─────────────┬─────────────┘
              │
              ▼
┌──────────────────────────┐
│  Text-to-Speech             │   Sarvam API — 11 Indian languages
│  (spoken answer)            │   (English, Hindi, Kannada, Tamil, Telugu,
│                              │   Malayalam, Marathi, Bengali, Gujarati,
│                              │   Punjabi, Odia)
└─────────────┬─────────────┘
              │
              ▼
┌──────────────────────────┐
│  Text + Audio response      │
│  rendered back to the user  │
└──────────────────────────┘
```

### Why one model instead of a multi-stage pipeline

The paper's diagram specifies separate components for the vision encoder
(CLIP/ViT), the VLM (BLIP-2/LLaVA), captioning, object detection, scene
understanding, and contextual reasoning. A modern multimodal LLM (Gemini)
performs all of these as a single forward pass over image+text input — it was
trained end-to-end to do exactly that. Chaining separate specialist models
would add latency and integration complexity without adding capability, so
those stages are implemented as one API call rather than six.

## Tech stack

| Layer | Choice | Covers |
|---|---|---|
| App framework | Next.js (App Router) | Frontend UI + backend API routes in one deployable app |
| Vision + language | Gemini API (`gemini-3.1-flash-lite`, fallback `gemini-3.6-flash`) | Image/video understanding, captioning, object/scene understanding, contextual reasoning, VQA, personalization, translation |
| Speech-to-text | Web Speech API (browser-native) | Voice input, no backend cost or latency |
| Text-to-speech | Sarvam API | Multilingual audio output for Indian languages |
| Styling | Tailwind CSS | UI |

## Project structure

```
app/
  page.tsx           UI: upload, camera/mic input, persona + language pickers, answer + playback
  api/ask/route.ts    Vision + VQA + personalization + translation (Gemini)
  api/speak/route.ts  Text-to-speech (Sarvam)
draft paper_3498.docx  Original research proposal this app implements
```

## How a request flows through the code

1. **`app/page.tsx`** — user uploads an image/video (`<input type="file">`),
   or speaks a question via the browser's `SpeechRecognition` API, and picks
   a persona and target language.
2. **`POST /api/ask`** — the image/video (base64) and question are sent to
   Gemini in one call, with the persona and language folded into the prompt.
   Gemini returns an answer that is already tailored and already translated.
   If the primary model is unavailable, the route automatically retries with
   a fallback model.
3. **`POST /api/speak`** — the answer text is sent to Sarvam, which returns
   base64 WAV audio in the selected language, played back via an `<audio>`
   element.

## Setup

1. `.env` holds `GEMINI_API_KEY` and `SARWAM_API_KEY` (gitignored).
2. `npm install`
3. `npm run dev`
4. Open http://localhost:3000

## Mapping back to the paper's objectives

| Paper objective | Implementation |
|---|---|
| Image + live image + video understanding | Gemini multimodal input |
| Context-aware descriptions | Gemini captioning/reasoning in the same call |
| VQA, text↔audio | `/api/ask` (text) + `/api/speak` (audio) |
| Personalized explanation | Persona instruction in the Gemini prompt |
| Multilingual translation | Target-language instruction in the Gemini prompt |
| Speech-to-Text | Browser Web Speech API |
| Text-to-Speech | Sarvam API |
| Unified platform | Single Next.js app, one interface |

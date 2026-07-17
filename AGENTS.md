# AGENTS.md — Contextual Assistant

## Project Overview

**Contextual Assistant** is a smart journal / personal knowledge-base app that combines free-form note-taking with AI-powered conversational insights. The user writes notes (facts, ideas, thoughts) and asks questions; the AI answers using only the accumulated notes as context. It also integrates live production-cost data from an external API for business analysis.

**Key capabilities:** note-taking, AI Q&A (Google Gemini), voice transcription (Groq Whisper), long-form "Deep Read" synthesis, production cost analysis, first-principles thinking ("Brown's Razor"), and note export.

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | **Next.js 14** (App Router) |
| Language | **TypeScript** (strict mode) |
| Frontend | **React 18**, Tailwind CSS, Framer Motion, Lucide React icons |
| AI | **OpenCode Zen** (Grok) for chat/specialists; optional **Gemini** for fact extraction |
| Voice | **Groq Whisper** large-v3-turbo (`groq-sdk`) |
| Database | **Firebase/Firestore** — conversations + fact ledger (`note_fact_index`, `fact_events`, `current_state`) |
| Markdown | `react-markdown` + `remark-gfm` |
| Utilities | `clsx`, `tailwind-merge`, `ffmpeg-static` (audio processing) |

## Architecture

```
app/
├── layout.tsx          # Root layout (Inter font, dark theme, metadata)
├── page.tsx            # Main page — unified chat + Deep Read tabs
├── globals.css         # Global styles (aurora background, custom CSS)
└── api/
    ├── chat-enhanced/  # Streaming AI chat endpoint (Gemini)
    ├── conversations/  # CRUD for conversation persistence (Postgres)
    ├── dishes-proxy/   # Proxy for external production-cost API
    ├── download-notes/ # Server-side note export
    ├── longform/       # Deep Read long-form generation endpoint
    ├── notes/          # Notes API
    └── transcribe/     # Voice transcription (Groq Whisper)

components/
├── chat-interface.tsx       # Main chat UI component
├── voice-session-panel.tsx  # Voice recording session UI
└── ui/
    ├── input-area.tsx       # Text input + action buttons
    └── message-bubble.tsx   # Individual message rendering

lib/
├── hooks/
│   └── useVoiceRecorder.ts  # Custom hook for voice recording & chunked transcription
├── postgres.ts              # Neon Postgres connection singleton
├── storage.ts               # Storage utilities
└── utils.ts                 # General utilities

scripts/
├── fetchThoughts.js         # Script to fetch thoughts from DB
└── restore-notes.js         # Script to restore notes

types/
├── global.d.ts              # Global type declarations
└── shims.d.ts               # Module shims
```

### Data Flow

1. **Notes** are saved to Neon Postgres via `/api/conversations` (auto-saved with debounce).
2. **AI questions** send the last 100 context items (notes + AI responses, excluding questions) to `/api/chat-enhanced`, which streams back text, thoughts, and code execution results via SSE.
3. **Voice notes** are recorded in the browser, sent to `/api/transcribe` (Groq Whisper), and auto-saved as notes.
4. **Deep Read** calls `/api/longform` which fetches all notes from the DB and generates a long-form synthesis, streamed back to the client.
5. **Production costs** are fetched via `/api/dishes-proxy` from `https://cogs-two.vercel.app/api/dishes/prices` and included in AI context.
6. **Fact ledger** extracts atomic facts from notes (on save + `/api/facts/sync` backfill) into Firestore `fact_events` / `current_state`. AI prompts always get CURRENT STATE before recent notes. Embeddings retrieval is optional and off by default.

## Building and Running

### Prerequisites

- Node.js (compatible with Next.js 14)
- A `.env.local` file (copy from `.env.example`) with:
  - `DATABASE_URL` — Neon Postgres connection string
  - Gemini API key
  - `GROQ_API_KEY` — for voice transcription
  - `GEMINI_MODEL` (optional, defaults to `models/gemini-2.5-flash`)

### Commands

| Command | Description |
|---------|-------------|
| `npm install` | Install dependencies |
| `npm run dev` | Start development server (http://localhost:3000) |
| `npm run build` | Create production build |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |

### Type Checking

```bash
npx tsc --noEmit
```

## Development Conventions

### Code Style

- **TypeScript** with strict mode enabled. All new code must be typed.
- **React:** Functional components with hooks. State managed via `useState`; no external state library.
- **`'use client'`** directive on components that use browser APIs or React hooks.
- **Styling:** Tailwind CSS exclusively — no CSS modules or styled-components. Use `clsx` and `tailwind-merge` for conditional classes.
- **Imports:** Use `@/*` path alias (mapped to project root). Prefer named exports for components.
- **Icons:** Use `lucide-react` for all icons.
- **Animations:** Use `framer-motion` for transitions and animations.

### Naming Conventions

- **Files:** kebab-case for all files (`chat-interface.tsx`, `useVoiceRecorder.ts`).
- **Components:** PascalCase (`ChatInterface`, `VoiceSessionPanel`).
- **Hooks:** camelCase with `use` prefix (`useVoiceRecorder`).
- **API routes:** kebab-case directories under `app/api/`.

### UI / Design System

- **Dark-first design** — pure black (`#000000`) background, AMOLED-friendly.
- **Glassmorphism** — `backdrop-blur`, semi-transparent surfaces (`rgba(255,255,255,0.05)`).
- **Aurora background** effect via CSS.
- **Color palette:** defined in `tailwind.config.js` — use semantic tokens (`text-primary`, `glass`, `accent-*`).
- **Font:** Inter (Google Fonts), serif for Deep Read view.
- **Responsive:** mobile-first, works on all screen sizes.

### API Patterns

- API routes live in `app/api/[name]/route.ts` (Next.js App Router convention).
- Streaming responses use SSE (`data:` prefixed JSON lines).
- Postgres access through `lib/postgres.ts` singleton (`getSql()`).

### ESLint

- Extends `next/core-web-vitals` (see `.eslintrc.json`).

### No Test Framework

There is no test framework currently configured. If tests are needed, a framework should be set up first (e.g., Jest + React Testing Library).

## License

Proprietary — All Rights Reserved. See `LICENSE` file.

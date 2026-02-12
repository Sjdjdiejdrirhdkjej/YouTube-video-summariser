# replit.md

## Overview

**Summa** is a full-stack YouTube video summarizer web application. Users paste a YouTube video URL and receive an AI-generated summary using a hybrid approach that combines Google Gemini (direct video processing) and Cohere (transcript fusion with reasoning). The app supports streaming responses, chat-with-summary functionality, shareable summary links, persistent conversations, and an IP/fingerprint-based credit system for rate limiting.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Framework**: React 18 with TypeScript
- **Bundler**: Vite (v3)
- **Styling**: Plain CSS with CSS custom properties (variables) for theming (light/dark mode via `data-theme` attribute)
- **Font**: Plus Jakarta Sans (Google Fonts)
- **Key Libraries**: `marked` for Markdown rendering, `react-instantsearch` + Algolia for search (partially integrated)
- **Routing**: Custom client-side routing via `window.location.pathname` state in `App.tsx` — no React Router. Pages include: main summarizer, changelog (`/changelog`), shared summary (`/<id>`), chat (`/chat/<id>`)
- **Device Identity**: Browser fingerprint generated via `crypto.randomUUID()` stored in localStorage, sent via `X-Fingerprint` header
- **Streaming**: Server-Sent Events (SSE) for real-time summary generation, chat responses, and AI thinking process display

### Backend
- **Framework**: Express.js v5 running on Node.js with TypeScript (loaded via `tsx/esm`)
- **Server Entry**: `server/index.ts` starts Express on port 3001; `server/app.ts` contains all route definitions and middleware
- **Environment**: `dotenv` with multi-path `.env` file resolution
- **Data Storage**: **In-memory Maps** for summaries, chats, and user credits — all data is ephemeral and resets on restart. There is no database currently in use for the main app.
  - Note: There are Replit integration files under `server/replit_integrations/` and `.replit_integration_files/` that reference Drizzle ORM with PostgreSQL schemas (`pgTable`, `drizzle-orm/pg-core`), but these are scaffolded integration templates and are **not wired into the main application**. If adding persistence, a PostgreSQL database with Drizzle ORM would be the natural path.
- **API Design**: RESTful endpoints with SSE streaming for long-running AI operations

### API Endpoints
| Endpoint | Method | Purpose | Credit Cost |
|---|---|---|---|
| `/api/summarize` | POST | Summarize via Gemini | 5 |
| `/api/summarize-hybrid` | POST | Summarize via Cohere hybrid fusion | 3 |
| `/api/chat` | POST | Chat about a summary | 1 |
| `/api/credits` | GET | Check credit balance | 0 |
| `/api/summary/:id` | GET | Retrieve shared summary | 0 |
| `/api/chat/:id` | GET | Retrieve saved chat | 0 |
| `/api/my-chats` | GET | List user's chats | 0 |
| `/api/changelog` | GET | Serve changelog content | 0 |

### YouTube Data Pipeline (`server/youtube.ts`)
The app gathers multiple "signals" from a YouTube video in parallel:
1. **oEmbed** — title, author, thumbnail
2. **Watch page metadata** — description, chapters, tags (scraped from HTML)
3. **Transcript** — fetched via multi-provider fallback chain: direct API → Invidious proxy instances → custom scraping (`server/youtube-transcript-simple.ts`)
4. **Top comments** — scraped when available

These signals are fused into a prompt for the AI model.

### AI Integration Flow
- **Gemini path** (`/api/summarize`): Uses `@google/genai` / `@google/generative-ai` with `gemini-2.0-flash-exp` for direct video processing
- **Hybrid path** (`/api/summarize-hybrid`): Gathers all YouTube signals, builds a fusion prompt, sends to Cohere `command-a-03-2025` (or `command-a-reasoning-08-2025` for thinking), streams response via SSE
- **Chat**: Uses Cohere for conversational follow-up about summaries
- **Thinking display**: AI reasoning/thinking tokens are streamed to the client and shown in a collapsible panel

### Credit System
- Each device (identified by IP + fingerprint) gets 500 free credits
- Different endpoints cost different amounts (see table above)
- Credits are tracked in-memory and returned via SSE and REST

### Development Setup
- `npm run dev` uses `concurrently` to run Vite dev server and Express backend simultaneously
- Vite proxies `/api` requests to `localhost:3001`
- TypeScript strict mode enabled

### Deployment
- Configured for **Vercel** deployment with `vercel.json` rewrites
- API routes go to `server/index.ts` (Node.js 20.x runtime)
- All other routes serve `index.html` (SPA)
- Environment variables: `GEMINI_API_KEY`, `COHERE_API_KEY`

### Replit Integration Files
The `server/replit_integrations/` directory contains pre-scaffolded integration modules (audio, chat, image, batch processing) that use the Replit AI Model Farm (`AI_INTEGRATIONS_OPENAI_API_KEY`). These are **template code** and not actively used by the main summarizer app. They reference a Drizzle + PostgreSQL setup with a `db` import from `../../db` and shared schema from `@shared/schema` — these files don't exist yet in the main app.

## External Dependencies

### AI Services (Required)
- **Google Gemini API** (`GEMINI_API_KEY`) — Used for direct video summarization via `@google/genai` and `@google/generative-ai` packages
- **Cohere API** (`COHERE_API_KEY`) — Used for hybrid transcript fusion summarization and chat via `cohere-ai` package. Model: `command-a-03-2025` / `command-a-reasoning-08-2025`

### AI Services (Optional / Scaffolded)
- **Replit AI Model Farm** (`AI_INTEGRATIONS_OPENAI_API_KEY`, `AI_INTEGRATIONS_OPENAI_BASE_URL`) — OpenAI-compatible API for image generation, audio, and chat. Only used by integration template files, not the main app.

### External APIs
- **YouTube** — oEmbed API, watch page scraping, transcript fetching
- **Invidious** — Privacy-respecting YouTube proxy instances used as transcript fallback (configurable via `YT_INVIDIOUS_URLS` env var)
- **Algolia** (`VITE_ALGOLIA_APP_ID`, `VITE_ALGOLIA_SEARCH_API_KEY`) — Search integration exists in `src/components/Search.tsx` but appears to be a partial/unused feature

### Database
- **Currently**: In-memory Maps (no persistent database)
- **Scaffolded**: Drizzle ORM with PostgreSQL schemas exist in Replit integration files. If persistence is needed, add PostgreSQL and wire up Drizzle with the existing schema patterns in `.replit_integration_files/shared/models/`.

### Key NPM Packages
- `express` v5 — HTTP server
- `vite` v3 + `@vitejs/plugin-react` — Frontend build
- `react` v18 — UI framework
- `marked` — Markdown to HTML rendering
- `cohere-ai` — Cohere API client
- `@google/genai`, `@google/generative-ai` — Google Gemini clients
- `cors` — CORS middleware
- `dotenv` — Environment variable loading
- `concurrently` — Run multiple dev processes
- `zod` + `drizzle-zod` — Schema validation (available but lightly used)
- `p-limit`, `p-retry` — Concurrency and retry utilities for batch processing
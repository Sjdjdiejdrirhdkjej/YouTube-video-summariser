# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Changed

- **Parallel Invidious transcript fetching** — transcript requests to multiple Invidious instances now race in parallel via `Promise.any()` instead of trying sequentially, significantly reducing latency.
- **Deduplicated YouTube watch page fetch** — metadata and comments are now parsed from a single watch page fetch instead of two separate requests, halving network calls in `gatherSignals()`.
- **Redesigned summarize page with Manus.im-inspired dark theme** — full-page dark layout (#0a0a0a) with animated gradient orbs, glassmorphism panels, centered hero with "What would you like to summarize?" heading, pill-shaped suggestion buttons, rounded chat-style input bar with gradient send button, and modern glass-effect cards for progress, thinking, and results.

- **Faster summarization with direct video URL first** — the hybrid summarizer now tries Gemini's direct video URL processing first (no YouTube data fetching needed), falling back to the slower transcript/metadata gathering approach only if needed. This significantly reduces wait times for most videos.
- **Gemini model fallback chain** — direct video URL summarization now tries models in sequence: gemini-3-pro → gemini-2.5-pro → gemini-3-flash → gemini-2.5-flash, automatically falling back to the next model if one fails.

### Added

- **Multi-layer summarization fallback chain** — every valid YouTube URL now always produces a summary. The pipeline tries: Cohere → Gemini (text-based) → Gemini (direct video mode) → signal-based fallback summary → catch-all minimal summary, ensuring no request ever returns empty.
- **LLM provider cascade** — if Cohere fails (rate limit, network error, outage), the summarizer automatically retries with Gemini before falling through to non-LLM fallbacks.
- **Gemini direct video fallback** — when text-based LLM summarization produces no content, the system attempts Gemini's native video understanding as an additional fallback.
- **Credit refund on failure** — credits are now refunded in all error paths (API failures, config errors, validation errors) so users never lose credits for failed summarizations.

### Fixed

- **Signal list check was too strict** — metadata description and tags are now counted as valid signals; previously only oembed and chapters were recognized, causing unnecessary failures when a video had description/tags but no transcript.
- **`gatherSignals` failure no longer kills the pipeline** — if all signal gathering fails, the system constructs minimal signals and continues through all fallback layers instead of immediately returning an error.
- **`buildSignalFallbackSummary` could return empty** — the function now always includes transcript excerpts alongside other sections (not just as a last resort), includes tags, and has an ultimate catch-all message guaranteeing non-empty output.
- **Credits lost on config/validation errors** — credits are now refunded when the server returns early due to missing API keys or invalid input.

### Fixed

- **Summarization responses are now non-streaming JSON** — the `/api/summarize` and `/api/summarize-hybrid` endpoints now return a single final payload (`summary`, `summaryId`, `credits`) and the main app consumes that response directly, removing incremental SSE response streaming for summarize requests.
- **URL summarize no longer ends silently with blank output** — the main SSE parser now processes any final buffered `data:` event on stream completion (even without a trailing delimiter) and surfaces a clear error when no summary text is returned, instead of falling back to an empty state.
- **Blank summary after processing YouTube URL** — improved streaming delta parsing for Cohere responses (including alternate content shapes) and added a server-side signal-based fallback summary when the model streams no text, preventing completed runs from rendering an empty result.
- **AI thinking process now visible in all analysis paths** — previously, the thinking panel only appeared when both Gemini and Cohere analyses succeeded together. Now, when Cohere is available, all single-source analysis paths (Gemini-only or transcript-only) also route through Cohere reasoning, ensuring the AI thought process is always streamed and visible in the UI.

### Changed

- **Mobile responsiveness overhaul** — improved touch-friendly styles (tap highlight, text-size-adjust, touch-action), enhanced 640px/480px/360px breakpoints with better spacing, font sizing, and layout stacking, and added safe-area inset support for notched phones

### Added

- **Live AI thought process** — the reasoning model's internal thinking is now streamed live to the UI during video analysis, fusion, and chat. Displayed in a collapsible panel with monospace text, auto-scrolling, and a pulsing indicator while active.
- **True hybrid video analysis** — runs Gemini video AI and transcript extraction in parallel, then fuses results using Cohere Command A Reasoning (`command-a-reasoning-08-2025`) with an 8K thinking token budget. Chat also uses the same reasoning model (4K budget). Falls back to Gemini if Cohere is unavailable.
- **Sleek minimal UI redesign** — complete visual overhaul inspired by Linear/Vercel aesthetics: clean nav with "Summa" brand, inline input row with arrow button, skeleton loading animation, ghost-style action buttons with inline SVG icons, subtle empty state, and responsive mobile layout

### Changed

- **Multi-provider transcript fetching with Invidious fallback** — `fetchTranscript` now tries three providers in sequence: `@playzone/youtube-transcript` (direct), Invidious proxy instances (configurable via `YT_INVIDIOUS_URLS` env var), and legacy `youtube-transcript` — significantly improving reliability when YouTube blocks server-side requests

### Fixed

- **Thinking panel no longer flickers** — fixed `isThinking` toggling rapidly when backend interleaves progress text events with thinking tokens; now only transitions to "done" once actual thinking content has been received and text starts arriving
- **Thinking panel added to ChatPage** — the standalone chat page (`ChatPage.tsx`) now renders the AI thinking panel, matching the behavior of the main summarizer and inline chat components
- **Mobile optimization** — comprehensive responsive breakpoints at 640px, 480px, and 360px for typography, layout, chat panels, thinking panels, and touch targets; prevents iOS zoom on input focus
- **Fallback summary now actually streams to client** — when the AI produces no content, the metadata-based fallback summary is now sent to the client via SSE instead of only being saved server-side (fixes "0 stream events received" error)
- **Improved Cohere API error diagnostics** — "Summary generation produced no content" now reports which signals were available vs. missing, stream event count, and a helpful hint about transcript unavailability; when transcript is unavailable, error message now suggests using the standard summarize endpoint which uses a video model
- **Better prompts for metadata-only summaries** — fusion prompt generator now explicitly handles cases where only metadata is available (no transcript), giving clearer instructions to the AI to produce useful summaries from limited information like video descriptions, title, and tags
- **Better transcript error message** — `fetchTranscript` now explains that YouTube may have blocked the request or captions are disabled
- **Undefined transcript language** — fixed `language` field defaulting to `undefined` when `youtube-transcript` doesn't return a `lang` property
- **Removed noisy debug logging** — removed per-event `console.log('Cohere event:', event)` and debug SSE messages that leaked internal state to the client
- **Early bail on empty signals** — hybrid summarizer now fails fast with a clear error when no usable signals (transcript, metadata, oembed) are available, instead of sending an empty prompt to Cohere

### Added

- **IP-based credit system** — every IP gets 500 free credits (1 credit = 1¢); `/api/summarize` costs 5 credits, `/api/summarize-hybrid` costs 3 credits, `/api/chat` costs 1 credit; returns 403 when credits are exhausted
- **GET `/api/credits` endpoint** — returns the current credit balance and cost per credit for the requesting IP
- **Credits in SSE responses** — remaining credits are sent as the first SSE data event after connection, allowing the frontend to update its display in real-time
- **Credit balance display** — the header now shows the user's remaining credits (fetched from `/api/credits` on mount and updated in real-time via SSE responses); credit updates from the Chat component are propagated to the App via a custom DOM event
- **Shareable summary links** — each summary gets a unique ID (e.g. `/<id>`); a "Copy share link" button appears after summarization; anyone can view a shared summary at that URL
- **Visible summary IDs** — after generation, each summary now displays its ID in `/<id>` format on both generated and shared summary views
- **Fingerprint-backed save for standard summaries** — `POST /api/summarize` now persists generated summaries with the browser fingerprint and returns a `summaryId`, matching hybrid summarize behavior
- **Browser fingerprint** — summaries are saved and associated with a browser fingerprint (UUID stored in localStorage) sent via `X-Fingerprint` header
- **Shared summary view** — new `/<id>` route renders a saved summary with a link back to the video
- **Persistent chat conversations** — each chat gets a unique ID; conversations are saved per browser fingerprint and can be continued at `/chat/<id>`; inline chat panel shows a "Copy link" button after the first message
- **Chat retrieval endpoints** — `GET /api/chat/:id` returns a saved conversation; `GET /api/my-chats` lists all chats for the current fingerprint
- **Chat conversation storage** — chat messages are persisted server-side with unique IDs tied to browser fingerprints; the `POST /api/chat` endpoint accepts an optional `chatId` to continue existing conversations and returns the `chatId` via SSE before `[DONE]`
- **GET `/api/chat/:id` endpoint** — retrieve a saved chat conversation by ID
- **GET `/api/my-chats` endpoint** — list all chats for the current browser fingerprint, sorted by most recently updated

### Fixed

- **SSE streaming reliability** — fixed client-side SSE parser to correctly handle `\r\n` line endings and split events on `\n\n` boundaries instead of individual lines, preventing silent JSON parse failures
- **Error handling during streaming** — errors now properly stop the read loop and cancel the stream instead of continuing to read indefinitely
- **Client disconnect handling** — server now aborts AI generation when the client disconnects, preventing wasted API calls and `write after end` errors
- **Duplicate vite config** — removed `vite.config.ts` which conflicted with `vite.config.js`; Vite was loading the JS config (proxy to port 3001) while the TS config (Express middleware) was ignored, causing 500 errors when the backend server wasn't running
- **Proxy buffering** — added `X-Accel-Buffering: no` and `no-transform` headers to prevent reverse proxies from buffering the SSE stream
- **Component unmount cleanup** — added AbortController to cancel in-flight fetch requests and animation frames when navigating away mid-stream
- **Animation loop efficiency** — typewriter animation stops scheduling frames once streaming ends or an error occurs

### Added

- **Chat about this video** — after a summary is generated, a "Chat about this" button appears below the summary, opening an inline chat panel where users can ask follow-up questions with the summary as context; uses streaming Gemini responses with full conversation history
- **Rate limit handling** — server detects 429/rate-limit errors from Gemini and Cohere APIs and returns a `retryAfter` value; client shows a countdown timer, disables inputs during cooldown, and auto-clears the error when the countdown expires

### Removed

- Hardcoded sample YouTube URLs from the UI
- Fallback error messages that masked real errors (client now surfaces actual error messages)
- Silent `.catch(() => ({}))` swallowing of API error responses
- Empty-string fallbacks for Algolia env vars (now throws if missing)
- Fallback `'en'` language default in transcript extraction
- Mock `'Not available without API key'` message for missing comments
- Fallback `'0:00'` timestamp and empty title defaults in chapter extraction
- Empty-string fallbacks for oEmbed field values
- Fallback changelog content string on fetch failure (now shows actual error)

### Added

- **Hybrid Fusion Summarization** — new `/api/summarize-hybrid` endpoint that summarizes YouTube videos without a video model by combining multiple extracted signals:
  - Transcript extraction via `youtube-transcript` package
  - Video metadata (title, author) via YouTube oEmbed API
  - Description, tags, and chapters scraped from the watch page HTML
  - Best-effort top comments extraction from `ytInitialData`
  - All signals gathered in parallel with graceful degradation
  - Structured multi-signal prompt sent to Gemini as text-only input
- **Signal extraction module** (`server/youtube.ts`) with functions: `fetchTranscript`, `fetchOEmbed`, `fetchWatchPageMetadata`, `fetchTopComments`, `gatherSignals`, `buildFusionPrompt`
- **Mode toggle** in the frontend UI allowing users to switch between "Hybrid Fusion (transcript + metadata)" and "Video Model (Gemini direct)"
- **Changelog page** at `/changelog` route, served via `GET /api/changelog` endpoint that reads `CHANGELOG.md` from the project root and renders it as markdown in the browser
- Transcript truncation guard (60k char limit with middle-out truncation) to prevent token overflow
- SSE stream header showing which signals were successfully gathered

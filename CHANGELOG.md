# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Fixed

- **Improved Cohere API error diagnostics** — "Summary generation produced no content" now reports which signals were available vs. missing, stream event count, and a helpful hint about transcript unavailability
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

## 2026-02-14: Current summarize + chat streaming contracts (server SSE + frontend parsers)

### Backend endpoints (server/app.ts)
- `POST /api/summarize-hybrid` (SSE on success path): emits `data: {"progress": {...}}` events, then `data: {"summary", "summaryId", "credits", "sources", "thinking?"}`, then `data: [DONE]`.
- `POST /api/chat` (SSE on success path): emits initial `data: {"credits": number}`, then token events `data: {"thinking"}` and `data: {"text"}`, then `data: {"chatId"}`, then `data: [DONE]`.
- `GET /api/summary/:id` (SSE): emits initial metadata `data: {"id", "videoUrl", "summary": "", "createdAt"}`, then chunk events `data: {"summary": "...chunk..."}`, then `data: [DONE]`.
- `GET /api/chat/:id` (NOT SSE): JSON `{ id, videoUrl, summary, messages, createdAt }`.

### SSE framing and sentinels
- SSE headers are set with `Content-Type: text/event-stream; charset=utf-8`, plus `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, `X-Accel-Buffering: no`.
- Keepalive/comment frame is emitted first: `: ok`.
- No named SSE events (`event:`) are used; all payloads are `data:` lines with JSON, plus literal sentinel `data: [DONE]`.

### Frontend parser expectations
- `src/components/YTSummarisePage.tsx` parses summarize SSE and expects:
  - `progress.step`, `progress.message`, optional `progress.thinking`, optional `progress.timestamp`
  - final `summary`, `summaryId`, optional `thinking`, optional `credits`, optional `sources[]`
  - optional `error`, optional `retryAfter`
  - stops on `[DONE]`
- `src/components/ChatPage.tsx` parses:
  - `GET /api/summary/:id` stream: reads `videoUrl` and concatenates `summary` chunks; stops on `[DONE]`
  - `POST /api/chat` stream: expects optional `error`, `retryAfter`, `credits`, `chatId`, `thinking`, `text`; stops on `[DONE]`
- `src/components/Chat.tsx` parses `POST /api/chat` stream with same field expectations as `ChatPage`.
- `src/components/SharedSummary.tsx` also parses `GET /api/summary/:id` stream and concatenates `summary` chunks until `[DONE]`.

### Coupling to fingerprint/credits to unwind safely
- Backend requires `X-Fingerprint` for `POST /api/summarize-hybrid` and `POST /api/chat`; missing header returns `400` JSON error.
- Credits are deducted before work (`5` summarize-hybrid, `1` chat), and insufficient credits return `403` JSON with `credits`.
- Credits are also streamed in-band in chat (`data: {"credits": ...}`) and returned in summarize final payload (`credits`), and frontend dispatches `credits-update` from streamed chat events.
- Saved summaries/chats are keyed with fingerprint server-side (`savedSummaries`, `savedChats` entries include `fingerprint`), and `GET /api/my-*` endpoints filter by fingerprint.

## 2026-02-14: Task 2 backend prompt-builder + share persistence changes

- `POST /api/summarize-hybrid` now remains SSE-based for progress UX, gathers signals via `gatherSignals(videoUrl)`, builds prompt via `buildFusionPrompt(signals)`, and emits final payload with at least `{ prompt, sources, videoUrl }` plus `signalStatus` and `cachedSummaryAvailable` metadata.
- No LLM calls are performed in summarize-hybrid anymore; mock mode paths were aligned to emit prompt-builder shaped payloads without credits/fingerprint coupling.
- Added `POST /api/summary` to persist frontend-provided completed summary (`{ videoUrl, summary, sources? }`) and return `{ summaryId }`; `GET /api/summary/:id` SSE replay remains intact and now includes `sources` in initial metadata frame.
- Replaced `POST /api/chat` with persistence endpoint that accepts `{ videoUrl, summary, messages }`, normalizes messages, stores in-memory, and returns `{ chatId }`; `GET /api/chat/:id` remains JSON retrieval.
- Removed credit/fingerprint identity coupling from backend routes: `/api/credits`, `/api/my-summaries`, and `/api/my-chats` are removed; fingerprint fields were removed from saved summary/chat models.
- Context7 Puter.js v2 docs review indicates auth should be user-token mediated at call time; backend-side token storage is not required for this persistence-only phase.

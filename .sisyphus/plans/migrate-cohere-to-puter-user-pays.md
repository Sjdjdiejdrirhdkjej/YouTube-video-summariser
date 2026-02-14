# Migrate Cohere Backend Streaming to Puter.js v2 User-Pays Frontend

## TL;DR

> **Quick Summary**: Remove Cohere (`cohere-ai`) and move all LLM calls to the browser using Puter.js v2 with per-user Puter auth (user-pays). Keep the Express backend only for YouTube signal gathering/prompt construction and for persisting shareable summaries/chats.
>
> **Deliverables**:
> - Frontend Puter auth + streaming summarize/chat using `puter.ai.chat(..., { stream: true })`
> - Backend prompt-building endpoint(s) (no AI calls) + endpoints to save/retrieve share links
> - Remove fingerprint credits system end-to-end
> - Remove Cohere dependencies/env/docs and update scripts/docs/changelog
>
> **Estimated Effort**: Medium
> **Parallel Execution**: YES - 2 waves
> **Critical Path**: Backend prompt endpoint → Frontend Puter streaming integration → Persistence wiring

---

## Context

### Original Request
Migrate from Cohere to Puter.js v2 and adopt true Puter user-pays: frontend Puter auth per user, AI calls in the browser; remove Cohere.

### Confirmed Decisions
- **Provider**: Puter.js v2 is the only LLM provider; remove Cohere.
- **Auth model**: Use Puter **user-pays** (frontend sign-in), not a single server token.
- **Capabilities**: LLM only (summarize + chat).
- **Model preference**: Prefer **Claude Opus 4.5 thinking**; if not available, fall back to non-thinking variant.
- **Credits**: Remove fingerprint-based credits/rate limiting entirely.
- **Sharing**: Keep shareable links for summaries and chats (backend persistence remains).

### Defaults Applied (override if needed)
- **Share link access**: Public read-only (no Puter auth required to view shared summaries/chats).
- **Retention**: Same as current behavior (in-memory maps; links last until server restart).

### Key Repo References
- Backend AI routes (current Cohere implementation): `server/app.ts`
- YouTube signal gathering/prompt building: `server/youtube.ts`
- Provider abstraction (currently partially bypassed): `server/llm-provider.ts`
- Summarize UI (SSE consumer): `src/components/YTSummarisePage.tsx`
- Chat UI (SSE consumer): `src/components/ChatPage.tsx`, `src/components/Chat.tsx`
- SSE verifier script (currently Cohere-era contract): `test-youtube-hybrid.js`

### External References (Puter Docs)
- `puter.ai.chat()` (streaming supported): https://docs.puter.com/AI/chat/
- Node/browser setup: https://docs.puter.com/getting-started/
- Model discovery: https://docs.puter.com/AI/listModels/
- Auth helpers: https://docs.puter.com/Auth/signIn/ , https://docs.puter.com/Auth/isSignedIn/
- Auth dialog alternative: https://docs.puter.com/UI/authenticateWithPuter/

---

## Work Objectives

### Core Objective
Replace all Cohere-backed summarization/chat with Puter.js v2 running in the browser (user-pays), while preserving the existing UX (streaming output, share links) and keeping backend responsibilities minimal.

### Concrete Deliverables
- Cohere removed from runtime code and dependencies (no `COHERE_API_KEY`, no `cohere-ai`, no `CohereClientV2`).
- Summarize flow:
  - Backend returns prompt + sources (and optional streamed progress while gathering signals), but does not call any LLM.
  - Frontend runs Puter streaming generation and then persists the final summary to backend to obtain a `summaryId` for sharing.
- Chat flow:
  - Frontend runs Puter streaming chat.
  - Frontend persists chat transcript to backend to obtain a `chatId` for sharing.
- Credits removed (UI + endpoints + server logic).
- Docs updated (`README.md`, `DEPLOYMENT.md`, `.env.example`, `CHANGELOG.md`).

### Must NOT Have (Guardrails)
- No Cohere codepaths left (including in health endpoints/docs/env).
- No new non-Puter auth providers.
- No forced “manual QA” steps in acceptance criteria; provide a deterministic mock mode for agent-executed verification.
- No large UI redesign beyond adding Puter sign-in state and removing credits.

---

## Verification Strategy (MANDATORY)

### Test Decision
- **Infrastructure exists**: Partial (Playwright dependency present, but no `npm run test` script).
- **Automated tests**: None required; use **Agent-Executed QA Scenarios** + existing node scripts.

### Agent-Executed QA Scenarios
Because Puter auth requires user interaction (popup/dialog), add a deterministic **frontend mock mode** (e.g. `VITE_PUTER_MOCK=1`) so the executing agent can verify summarize/chat streaming without real Puter credentials.

---

## Execution Strategy

Wave 1 (Can parallelize):
- Task 1: Backend Cohere removal + new prompt/persistence endpoints
- Task 2: Frontend Puter adapter + mock mode + auth UI scaffolding

Wave 2 (After Wave 1):
- Task 3: Frontend summarize flow (prompt → Puter stream → persist → share)
- Task 4: Frontend chat flow (Puter stream → persist → share)
- Task 5: Update scripts/docs/changelog and add verification commands

---

## TODOs

- [ ] 1. Remove Cohere from backend runtime + deps

  **What to do**:
  - Remove all direct Cohere usage from `server/app.ts` (`CohereClientV2`, `COHERE_API_KEY`, Cohere streaming logic).
  - Remove Cohere codepaths from `server/llm-provider.ts` (delete `CohereProvider` and related factory/config fields) or delete the whole abstraction if it becomes dead.
  - Remove `cohere-ai` from `package.json` and update lockfiles accordingly.
  - Update `server/app.ts` `/api/health` payload to no longer report Cohere key state.

  **Must NOT do**:
  - Don’t remove `@heyputer/puter.js`.
  - Don’t change YouTube signal-gathering logic in `server/youtube.ts` beyond wiring to new endpoints.

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Mostly deletions + wiring changes; low algorithmic complexity.
  - **Skills**: (none)

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 2)
  - **Parallel Group**: Wave 1

  **References**:
  - `server/app.ts` - Current Cohere usage in `/api/summarize-hybrid`, `/api/chat`, `/api/health`.
  - `server/llm-provider.ts` - Existing Cohere provider and factory.
  - `package.json` - `cohere-ai` dependency.

  **Acceptance Criteria**:
  - [ ] `npm run build` succeeds.
  - [ ] `grep -R "CohereClientV2" -n server src` returns no matches.
  - [ ] `grep -R "COHERE_API_KEY" -n server src package.json .env.example` returns no matches.
  - [ ] App still starts: `npm run dev` (manual run by agent) and `GET /api/health` returns 200 JSON.

  **Agent-Executed QA Scenarios**:
  - Scenario: Backend starts without Cohere env
    Tool: Bash
    Preconditions: No `COHERE_API_KEY` in environment
    Steps:
      1. Run `npm install`
      2. Run `npm run dev:server`
      3. `curl -sS http://localhost:3001/api/health`
      4. Assert JSON has `ok: true` and no `hasCohereKey`
    Expected Result: Server runs and health endpoint works

- [ ] 2. Implement backend “prompt builder” + persistence endpoints (no AI)

  **What to do**:
  - Refactor `POST /api/summarize-hybrid` in `server/app.ts`:
    - Keep YouTube URL validation.
    - Keep signal gathering via `gatherSignals(videoUrl)` and prompt creation via `buildFusionPrompt(signals)`.
    - Stream progress events during signal gathering if you want to preserve progress UX, but do **not** call any LLM.
    - Return a final payload that includes at minimum: `{ prompt, sources, videoUrl }` (and any existing metadata the frontend needs).
  - Add an endpoint to persist a completed summary coming from the frontend and return a share id:
    - Recommended: `POST /api/summary` accepts `{ videoUrl, summary, sources? }` and returns `{ summaryId }`.
    - Keep `GET /api/summary/:id` (SSE chunked replay) working with stored summaries.
  - Add an endpoint to persist a completed chat coming from the frontend and return a share id:
    - Recommended: `POST /api/chat` (or `POST /api/chat/save`) accepts `{ videoUrl, summary, messages }` and returns `{ chatId }`.
    - Keep `GET /api/chat/:id` working.
  - Remove credits + fingerprint coupling:
    - Remove `/api/credits`.
    - Remove fingerprint requirements from endpoints where not needed.
    - Remove `/api/my-summaries` and `/api/my-chats` (or clearly redefine them) since fingerprint identity is removed.

  **Must NOT do**:
  - Don’t add new databases; keep current in-memory maps unless user asked for persistence beyond runtime.
  - Don’t store Puter auth tokens server-side.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: API contract changes + streaming/progress compatibility + persistence wiring.
  - **Skills**: (none)

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 2)
  - **Parallel Group**: Wave 1

  **References**:
  - `server/app.ts` - Current SSE helpers, `/api/summarize-hybrid`, summary/chat maps, `/api/summary/:id`, `/api/chat/:id`.
  - `server/youtube.ts` - `gatherSignals`, `buildFusionPrompt`, `extractVideoId` patterns.
  - `src/components/YTSummarisePage.tsx` - Current event expectations (`progress`, final payload) to keep/adjust.

  **Acceptance Criteria**:
  - [ ] `POST /api/summarize-hybrid` returns a final payload containing a non-empty `prompt` string.
  - [ ] `POST /api/summarize-hybrid` does not call any LLM libraries (no network calls to Cohere/OpenAI for summarization).
  - [ ] `POST /api/summary` returns `{ summaryId }` and `GET /api/summary/:id` replays the saved summary.
  - [ ] `POST /api/chat` returns `{ chatId }` and `GET /api/chat/:id` returns stored messages.

  **Agent-Executed QA Scenarios**:
  - Scenario: Prompt builder returns prompt
    Tool: Bash (curl)
    Preconditions: Server running on localhost:3001
    Steps:
      1. `curl -sS -N -X POST http://localhost:3001/api/summarize-hybrid -H 'content-type: application/json' -d '{"videoUrl":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"}'`
      2. Assert stream contains JSON with `progress` events
      3. Assert final JSON contains `prompt`
      4. Assert stream ends with `data: [DONE]`
    Expected Result: Endpoint returns prompt and finishes cleanly

- [ ] 3. Add frontend Puter client adapter + mock mode + sign-in UI

  **What to do**:
  - Create a thin client wrapper (e.g. `src/lib/puterClient.ts`) that exposes:
    - `isSignedIn(): boolean`
    - `signIn(): Promise<void>` (must be user-gesture driven)
    - `chatStream(messages, options): AsyncIterable<{ text?: string }>`
  - Implement real mode using Puter SDK per docs (`@heyputer/puter.js` import) and streaming via `puter.ai.chat(..., { stream: true, model })`.
  - Implement mock mode behind `VITE_PUTER_MOCK=1`:
    - Always “signed in” (or controllable)
    - Stream deterministic chunks for both summarize and chat.
  - Add minimal UI affordance for auth:
    - A “Sign in with Puter” button (nav is a natural location: `src/components/YTSummarisePage.tsx`).
    - Disable summarize/chat actions until signed in (real mode).

  **Model selection**:
  - Attempt model ids in this order:
    1. `claude-opus-4-5-thinking` (best guess for “thinking” variant)
    2. `claude-opus-4-5`
    3. `claude-opus-4-5-latest` (documented alias style)
  - If the first attempt fails with “model not found/invalid”, automatically retry with the next.
  - (Optional) Call `puter.ai.listModels()` once post-auth and cache whether the thinking id exists.

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: UI auth state + integration into existing UX.
  - **Skills**: `frontend-ui-ux`
    - `frontend-ui-ux`: Keep the existing visual language while inserting auth state cleanly.

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 1-2)
  - **Parallel Group**: Wave 1

  **References**:
  - `src/components/YTSummarisePage.tsx` - Top nav area currently shows credits; replace with auth state.
  - Puter auth docs: https://docs.puter.com/Auth/signIn/ and https://docs.puter.com/UI/authenticateWithPuter/
  - Puter streaming docs: https://docs.puter.com/AI/chat/
  - Model discovery docs: https://docs.puter.com/AI/listModels/

  **Acceptance Criteria**:
  - [ ] With `VITE_PUTER_MOCK=1`, app can stream deterministic output without any external auth.
  - [ ] With mock off, clicking “Sign in with Puter” triggers Puter auth (popup/dialog) only from user gesture.
  - [ ] Summarize/chat actions are gated when not signed in (real mode).

  **Agent-Executed QA Scenarios**:
  - Scenario: Mock sign-in + streaming works end-to-end
    Tool: Playwright
    Preconditions: `VITE_PUTER_MOCK=1` and dev server running
    Steps:
      1. Navigate to `http://localhost:5173/`
      2. Assert the UI indicates signed-in (mock) or enables summarize action
      3. Paste a URL and click summarize
      4. Assert summary output grows over time (streaming)
    Evidence: screenshot `.sisyphus/evidence/puter-mock-summarize.png`

- [ ] 4. Rewrite summarize flow: prompt builder → Puter stream → persist → share

  **What to do**:
  - Update `src/components/YTSummarisePage.tsx`:
    - Remove credits fetching (`GET /api/credits`) and credits display.
    - Call backend summarize endpoint to obtain `prompt` (+ optional streamed progress).
    - Run `puterClient.chatStream(...)` with `{ stream: true }` and stream chunks into `displayedSummary`.
    - When stream completes, call backend `POST /api/summary` to save and receive `summaryId`.
    - Keep existing “Copy link” UX, but based on the persisted `summaryId`.
  - Ensure abort/cancel stops streaming and does not persist partial summaries unless explicitly desired.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Non-trivial async/streaming state management + abort semantics.
  - **Skills**: `frontend-ui-ux`

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 5)
  - **Parallel Group**: Wave 2
  - **Blocked By**: Tasks 2-3

  **References**:
  - `src/components/YTSummarisePage.tsx` - Current SSE parsing + progress UI.
  - `server/app.ts` - Updated summarize-hybrid endpoint contract.
  - Puter streaming docs: https://docs.puter.com/AI/chat/

  **Acceptance Criteria**:
  - [ ] Summarize generates output via Puter streaming (mock mode must pass deterministically).
  - [ ] After completion, backend returns a `summaryId` and share link loads content.
  - [ ] Credits UI and `/api/credits` are fully removed.

  **Agent-Executed QA Scenarios**:
  - Scenario: Summarize + share link works (mock)
    Tool: Playwright
    Preconditions: `VITE_PUTER_MOCK=1`, server running
    Steps:
      1. Navigate to app
      2. Input `https://www.youtube.com/watch?v=dQw4w9WgXcQ`
      3. Click summarize
      4. Wait for summary to finish streaming (UI indicates complete)
      5. Click copy link, navigate to copied URL
      6. Assert summary content is rendered
    Evidence: screenshots `.sisyphus/evidence/summary-generated.png`, `.sisyphus/evidence/summary-share-page.png`

- [ ] 5. Rewrite chat flow: Puter stream → persist → share

  **What to do**:
  - Update `src/components/Chat.tsx` and `src/components/ChatPage.tsx`:
    - Replace `/api/chat` SSE streaming with direct Puter streaming.
    - Construct messages as a Puter messages array (use `system` role for the summary context).
    - Stream assistant deltas into the UI.
    - After completion, persist full transcript to backend and receive `chatId`.
  - Ensure share link (`/chat/:id`) loads via `GET /api/chat/:id` unchanged.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Streaming state management and persistence wiring.
  - **Skills**: `frontend-ui-ux`

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 4)
  - **Parallel Group**: Wave 2
  - **Blocked By**: Tasks 2-3

  **References**:
  - `src/components/Chat.tsx` and `src/components/ChatPage.tsx` - Current SSE parsing logic.
  - `server/app.ts` - Updated chat persistence endpoint.
  - Puter messages support is part of `puter.ai.chat()` docs: https://docs.puter.com/AI/chat/

  **Acceptance Criteria**:
  - [ ] Chat streams assistant output via Puter (mock mode deterministically).
  - [ ] After completion, backend returns `chatId`, and share link loads transcript.

  **Agent-Executed QA Scenarios**:
  - Scenario: Chat + share link works (mock)
    Tool: Playwright
    Preconditions: `VITE_PUTER_MOCK=1`, existing summary available (or use summaryId flow)
    Steps:
      1. Navigate to app, generate a summary
      2. Open chat panel, send message “What is the main point?”
      3. Assert assistant response streams in (text length increases)
      4. Click copy chat link, navigate to it
      5. Assert chat messages render
    Evidence: screenshots `.sisyphus/evidence/chat-stream.png`, `.sisyphus/evidence/chat-share.png`

- [ ] 6. Update verification script(s) and documentation

  **What to do**:
  - Update `test-youtube-hybrid.js` verifier mode to match new backend contract:
    - Verify prompt builder returns `prompt` and `[DONE]` within deadlines.
    - Remove checks for `credits` and `timings.cohereMs`.
  - Update docs:
    - `README.md`: remove Cohere mentions; describe Puter sign-in requirement + user-pays.
    - `DEPLOYMENT.md`: remove `COHERE_API_KEY` and Cohere dashboard references.
    - `.env.example`: remove Cohere; keep only envs that are still used.
  - Update `CHANGELOG.md` under `[Unreleased]` with user-facing changes:
    - Cohere removed; Puter user-pays; credits removed; auth UI added.

  **Recommended Agent Profile**:
  - **Category**: `writing`
    - Reason: Mostly docs + verification harness updates.
  - **Skills**: (none)

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2

  **References**:
  - `test-youtube-hybrid.js` - Existing SSE verifier.
  - `README.md`, `DEPLOYMENT.md`, `.env.example`, `CHANGELOG.md`.
  - Puter docs (auth + chat) linked in Context section.

  **Acceptance Criteria**:
  - [ ] `node test-youtube-hybrid.js --expect-first-event-ms 2000 --expect-done-ms 15000` exits 0 against the new prompt builder.
  - [ ] `README.md` and `DEPLOYMENT.md` no longer mention Cohere.
  - [ ] `CHANGELOG.md` has a clear `[Unreleased]` entry describing the migration.

---

## Commit Strategy

Suggested atomic commits (executor may adjust):
1. `refactor(backend): remove cohere and add prompt/persistence endpoints`
2. `feat(frontend): add puter auth + mock mode adapter`
3. `feat(summarize): stream via puter and persist summaries`
4. `feat(chat): stream via puter and persist chats`
5. `docs: update env + deployment + changelog`

---

## Success Criteria

### Verification Commands
```bash
npm run build
node test-youtube-hybrid.js --expect-first-event-ms 2000 --expect-done-ms 15000
```

### Final Checklist
- [ ] No Cohere dependencies or env vars remain.
- [ ] Users can authenticate with Puter and generate summaries/chats client-side.
- [ ] Share links for summaries and chats work.
- [ ] Credits UI/endpoints are removed.
- [ ] Build succeeds and verification script passes.

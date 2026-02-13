# Video Summarization Speed + Hang Fix (Gemini SSE)

## TL;DR

> Quick Summary: Fix the "never finishes / no progress steps" hang by making SSE streaming provably deliver the first `data:` event quickly, adding hard end-to-end deadlines + stalled-stream timeouts, and guaranteeing the server always sends `data: [DONE]` on every path.
>
> Deliverables:
> - SSE reliability fixes (first progress event, heartbeat, `[DONE]` always)
> - Hard wall-clock timeout + abort/cancellation across Gemini/Cohere + disconnect handling
> - Instrumentation: per-stage timings surfaced in logs and final payload
> - Performance improvements (remove redundant transcript work; optional overlap of fallback prep)
> - Minimal automated test setup (tests-after) + agent-executable SSE verification (no secrets)

Estimated Effort: Medium
Parallel Execution: YES (2 waves)
Critical Path: SSE-first-byte reliability -> hard deadlines/always-DONE -> test harness -> perf optimizations

---

## Context

### Original Request
"research multiple websites to speed up video summaration. then fix it."

### What We Observed (repo)
- Frontend uses fetch-streamed SSE parsing in `src/components/YTSummarisePage.tsx` and waits until it reads `data: [DONE]`.
- Primary endpoint is `POST /api/summarize-hybrid` in `server/app.ts`.
- On cache miss, backend attempts: direct Gemini video summarization (races `gemini-3-pro` + `gemini-2.5-flash`, ~15s timeout) -> fallback to `gatherSignals()` (`server/youtube.ts`, has 10s timedFetch per YouTube fetch + transcript race) -> Cohere stream (or Gemini text fallback).

### User-Reported Symptom (confirmed)
- "It takes forever ... it just doesnt show up"
- UI shows **no progress steps** (stays on initial "Analyzing video..." state).
- Reproduces across local dev and deployments.

### External Research References (selected)
- Gemini API: Video understanding: https://ai.google.dev/gemini-api/docs/video-understanding
- Gemini API: Files API (media upload/handling): https://ai.google.dev/gemini-api/docs/files
- Vertex AI video understanding (similar concepts, different surface): https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/video-understanding
- Gemini 2.5 video understanding announcement: https://developers.googleblog.com/en/gemini-2-5-video-understanding/

---

## Work Objectives

### Core Objective
Make `/api/summarize-hybrid` fast and non-hanging: streaming progress should appear quickly, and every request must either produce a summary or a clear error within a bounded time.

### Concrete Deliverables
- SSE contract hardened for `/api/summarize-hybrid` (and optionally `/api/summarize`):
  - First progress `data:` event reliably delivered
  - Periodic heartbeat while work is ongoing
  - `data: [DONE]` always emitted
- End-to-end timeout + stalled-stream detection for Gemini and Cohere streaming paths.
- Per-stage timings: cache/direct/signals/cohere/gemini-fallback durations available for debugging and performance tuning.
- Remove redundant transcript provider work in `server/youtube.ts` / `server/youtube-transcript-simple.ts`.
- Minimal automated test stack (tests-after) plus agent-executable SSE verifier that runs without real API keys.
- Deployment config fixes/validation (Render start command and TypeScript runtime dependencies).

### Definition of Done
- Agent can run a local verification command that:
  - Observes a progress `data:` event quickly (target: <= 2s)
  - Observes termination (`data: [DONE]`) within a configured max (target: <= 90s in mock mode)
  - Proves error paths still terminate with `[DONE]`
- No request can hang indefinitely in mock mode, and live mode has a hard upper bound.

Default budgets (can be adjusted after measuring):
- First `data:` event budget: 2000ms
- Heartbeat interval: 5000ms
- Global request deadline (live): 90000ms
- Stall timeout (no chunks from an LLM stream): 30000ms

### Must NOT Have (guardrails)
- Do not remove SSE or change the client contract unless streaming is proven impossible on the target platform.
- Do not permanently downgrade to weaker models as the primary solution (Balanced intent). Model choice can be made configurable/observable.
- Do not introduce secrets into the repo; tests must run without `GEMINI_API_KEY`/`COHERE_API_KEY`.

---

## Verification Strategy (MANDATORY)

Universal rule: verification must be agent-executable. No "user manually checks" steps.

### Test Decision
- Infrastructure exists: NO (ad-hoc scripts only)
- Automated tests: YES (tests-after)
- Planned framework: Vitest (minimal) + a small Node-based SSE verifier script (integration-style)

### Agent-Executed QA Scenarios (for every task)
- Primary tool for SSE: Bash (`curl -N`) and/or Node script that reads the stream and asserts timings/events.
- UI-level sanity (optional): Playwright, but only if mock mode exists so no real API keys are needed.

---

## Execution Strategy

Wave 1 (Reliability + Observability)
- Task 1: Add mock mode + SSE verifier harness (enables automated QA)
- Task 2: SSE streaming correctness (first event + heartbeat) and client watchdog
- Task 3: Hard deadlines + always-DONE + abort-on-close

Wave 2 (Performance + Deployment + Tests)
- Task 4: Cancel losing Gemini streams; reduce wasted work/cost
- Task 5: Optional overlap of fallback prep to reduce p95 (guarded + measurable)
- Task 6: Remove redundant transcript provider work
- Task 7: Deployment fixes/validation (Render + runtime deps)
- Task 8: Add minimal Vitest + CI + a few targeted tests
- Task 9: Update `CHANGELOG.md` + docs consistency

---

## TODOs

### 1) Add deterministic mock mode + SSE verifier (no external keys)

What to do:
- Add a server-side "mock summarization" mode (env flag) that exercises the SSE pipeline and deterministically emits:
  - Immediate progress events
  - A few timed progress/heartbeat events
  - A final summary payload and `data: [DONE]`
- Standardize the flag as `SUMMA_MOCK_MODE` with explicit values:
  - `success`: normal deterministic stream (progress -> summary -> DONE)
  - `error`: emits an error payload then DONE
  - `stall_after_headers`: sends SSE headers and an initial comment only (no `data:`)
  - `stall_after_first_progress`: sends one progress `data:` then stalls
- Add a Node-based verifier script (or extend `test-youtube-hybrid.js`) that:
  - Calls `/api/summarize-hybrid`
  - Records time-to-first `data:` event
  - Asserts it receives `[DONE]` within a configurable budget
  - Optionally prints response headers
- Add a Playwright-based UI verifier script runnable via `node` that asserts the client watchdog surfaces an error in `stall_after_headers` mode.

Must NOT do:
- Do not require real API keys for this harness.

Recommended Agent Profile:
- Category: unspecified-high
- Skills: dev-browser (omit), playwright (omit)

Parallelization:
- Can Run In Parallel: YES (with Task 9 doc updates)

References:
- `server/app.ts` (SSE route and `writeProgress()` format)
- `src/components/YTSummarisePage.tsx` (client-side SSE framing expectations: `data:` + `\n\n` + `[DONE]`)
- `test-youtube-hybrid.js` (existing integration-style script patterns)

Acceptance Criteria (agent-executable):
- `SUMMA_MOCK_MODE=success node test-youtube-hybrid.js --expect-first-event-ms 2000 --expect-done-ms 5000` exits 0
- `SUMMA_MOCK_MODE=stall_after_headers node scripts/verify-ui-watchdog.mjs --timeout-ms 10000` exits 0

QA Scenarios:
Scenario: SSE mock produces progress then DONE
Tool: Bash/Node
Steps:
1. Start dev server
2. Run verifier script in mock mode
3. Assert first progress event <= 2s and DONE <= 5s
Expected: deterministic completion

---

### 2) Fix "no progress steps" by hardening SSE streaming + add client-side stall watchdog

What to do:
- Server-side:
  - Ensure the first progress `data:` event is emitted and flushed immediately after headers.
  - Add an SSE heartbeat while processing (either `data:` heartbeat event or comment) so proxies/platforms keep streaming.
  - Add an optional initial padding chunk (common SSE anti-buffer technique) if needed.
- Client-side:
  - Add a watchdog: if no `data:` event is received within N seconds after request start, abort + show actionable error + allow retry.
  - Track last-event time; if stream stalls for M seconds, abort.

Must NOT do:
- Do not change the client to rely on non-`data:` comment lines; keep compatibility with the existing parser.

Recommended Agent Profile:
- Category: unspecified-high
- Skills: playwright (useful for UI QA)

Parallelization:
- Can Run In Parallel: NO (depends on Task 1 harness for reliable verification)

References:
- `server/app.ts` (SSE headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`)
- `src/components/YTSummarisePage.tsx` (only advances UI on parsed `data:` JSON)
- `vite.config.js` (dev proxy; verify it does not buffer SSE)

Acceptance Criteria:
- In mock mode, client shows at least one progress step within 2s (Playwright), or verifier confirms first `data:` <= 2s.
- Client aborts and shows an error if no `data:` events arrive within configured threshold (mocked forced-stall scenario).

QA Scenarios:
Scenario: No-data stall triggers client watchdog
Tool: Playwright
Steps:
1. Run server with `SUMMA_MOCK_MODE=stall_after_headers`
2. Trigger summarize
3. Assert UI shows an error within N seconds and the request is aborted

---

### 3) Guarantee termination: end-to-end deadline + stalled-stream timeouts + always emit `[DONE]`

What to do:
- Add a single wall-clock deadline for the entire summarize request.
- Add explicit timeouts for Cohere stream and Gemini text stream stages (not just the direct-model race).
- Ensure every path (success, error, timeout, abort) ends the SSE stream:
  - emit `{ error: ... }` where appropriate
  - emit `data: [DONE]`
  - `res.end()`
- Ensure client disconnect (`req.on('close')`) aborts all in-flight work and intervals.
- Include a `timings` object in the final SSE payload (and in mock payload) so tests can assert stage durations, e.g. `{ cacheMs, directMs, signalsMs, cohereMs, geminiTextMs, totalMs }`.
- Include a `debug` object for cancellation/paths, e.g. `{ direct: { attemptedModels, winnerModel, cancelledLosers: true }, transcriptProvider: 'invidious' | '...' }`.

Recommended Agent Profile:
- Category: unspecified-high

Parallelization:
- Can Run In Parallel: NO (builds on Task 2)

References:
- `server/app.ts` (`/api/summarize-hybrid` and direct Gemini race)
- `server/youtube.ts` (`gatherSignals()` already uses timeouts; keep behavior)

Acceptance Criteria:
- Mock mode: verifier always observes `[DONE]` <= 5s.
- Forced error path: verifier observes an error payload and still observes `[DONE]`.

---

### 4) Cancel losing Gemini race streams (reduce waste, reduce tail)

What to do:
- Ensure that once one direct-model attempt wins, the other in-flight attempt is canceled/aborted and does not continue consuming bandwidth/cost.
- Ensure the "direct stage" timeout cancels all in-flight direct-model streams.

Recommended Agent Profile:
- Category: unspecified-high

Parallelization:
- Can Run In Parallel: YES (with Task 6)

References:
- `server/app.ts` (direct `Promise.any(directModels.map(... generateContentStream ...))`)
- Gemini docs for request cancellation/abort behavior (verify SDK support)

Acceptance Criteria:
- In `SUMMA_MOCK_MODE=success` (configured to simulate a race), the final payload includes `debug.direct.cancelledLosers === true`.

---

### 5) Optional: overlap fallback prep (Balanced p95 improvement)

What to do:
- After a short grace period, start non-paid fallback prep (e.g., `gatherSignals()` or a subset) in parallel while direct Gemini is running.
- If direct Gemini succeeds, cancel the fallback prep to avoid wasted work.
- Add per-stage timings so the benefit/cost is measurable.

Guardrails:
- Do not double paid LLM calls.
- If cancellation cannot be made effective, keep this feature behind a flag.

Recommended Agent Profile:
- Category: ultrabrain (for careful concurrency/cancellation logic)

Parallelization:
- Can Run In Parallel: NO (after Tasks 2-4)

References:
- `server/app.ts` (current gated phases)

Acceptance Criteria:
- A benchmark script (or extended verifier) runs N times in mock mode and prints p50/p95 `timings.totalMs`.
- With overlap enabled, p95 decreases without increasing paid LLM calls (validated by `debug` counters).

---

### 6) Remove redundant transcript provider work

What to do:
- Ensure transcript provider race in `server/youtube.ts` actually races distinct providers, or simplify to a single implementation to avoid redundant parallel fetch/parsing.
- Keep current reliability behavior (best-effort transcript; do not fail the entire request just because transcript is missing).

Recommended Agent Profile:
- Category: quick

Parallelization:
- Can Run In Parallel: YES (with Task 4)

References:
- `server/youtube.ts` (`fetchTranscriptPlayzone()` + `fetchTranscriptInvidious()`)
- `server/youtube-transcript-simple.ts` (both classes call same underlying `fetchTranscript()` today)

Acceptance Criteria:
- Final payload includes `debug.transcriptProvider` and it reflects only one attempt per request (no duplicate provider calls).

---

### 7) Deployment fixes/validation (Render + runtime deps)

What to do:
- Render: current `render.yaml` uses `node server/index.js` but repo does not emit server JS (`tsconfig.json` has `noEmit: true`). Fix by either:
  - using `tsx` at runtime, or
  - adding a separate server build step that emits JS and updating start command.
- Ensure `tsx` is declared explicitly in `package.json` (currently relied on implicitly via lockfile).
- Validate SSE headers/platform behavior for Vercel and Render (buffering/timeouts); keep heartbeat if needed.

Recommended Agent Profile:
- Category: unspecified-high

Parallelization:
- Can Run In Parallel: YES (with Task 6)

References:
- `render.yaml`
- `package.json` (scripts)
- `tsconfig.json` / `tsconfig.node.json`
- `vercel.json`

Acceptance Criteria:
- Render deploy starts successfully (agent can simulate with documented start command locally).

---

### 8) Add minimal test infra (tests-after) + CI

What to do:
- Add `npm run test` and minimal Vitest setup.
- Add a small suite that covers:
  - SSE framing/parser expectations (server emits `data:` + `\n\n` and `[DONE]`)
  - Timeout/always-DONE behavior in mock/stall modes
- Add a minimal CI workflow that runs `npm ci`, `npm run build`, `npm run test`.

Recommended Agent Profile:
- Category: unspecified-high

Parallelization:
- Can Run In Parallel: NO (after Task 1 harness exists)

References:
- `package.json` (missing `test` script)
- `AGENTS.md` (expects test/lint scripts; reconcile with repo reality)

Acceptance Criteria:
- `npm run test` passes in a clean checkout without API keys.

---

### 9) Update changelog + docs consistency

What to do:
- Update `CHANGELOG.md` with a user-facing entry under `[Unreleased]` describing hang fix + SSE reliability + timeouts.
- Reconcile docs that mention old Gemini model names (`README.md`, `replit.md`) vs current code in `server/app.ts`.

Recommended Agent Profile:
- Category: writing

Parallelization:
- Can Run In Parallel: YES (with Task 1)

References:
- `CHANGELOG.md`
- `README.md`
- `replit.md`
- `server/app.ts`

Acceptance Criteria:
- Changelog is updated and accurately reflects behavior.

---

## Commit Strategy

- Commit 1: "fix(sse): guarantee progress + done + timeouts"
- Commit 2: "test: add vitest + sse verifier"
- Commit 3: "perf(youtube): remove redundant transcript race"
- Commit 4: "chore(deploy/docs): render start + docs/changelog"

Each commit should include:
- verification: `npm run build` and `npm run test` (once tests exist)

---

## Success Criteria

Verification commands (agent-run):
- `SUMMA_MOCK_MODE=success node test-youtube-hybrid.js --expect-first-event-ms 2000 --expect-done-ms 5000`
- `SUMMA_MOCK_MODE=stall_after_headers node scripts/verify-ui-watchdog.mjs --timeout-ms 10000`

Final checklist:
- [ ] First progress `data:` event reliably appears quickly
- [ ] Requests never hang indefinitely (hard deadline)
- [ ] `[DONE]` always sent on success and error
- [ ] Cancellation prevents runaway background work
- [ ] Tests run without secrets
- [ ] `CHANGELOG.md` updated

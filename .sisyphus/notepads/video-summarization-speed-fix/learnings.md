# Learnings

- The client (`src/components/YTSummarisePage.tsx`) only reacts to `data:` lines and will wait indefinitely unless it sees `data: [DONE]`.
- The reported hang shows *no progress steps*, suggesting SSE bytes may not be delivered/parsed (first-byte / buffering / framing), not only "slow model".

- Added `SUMMA_MOCK_MODE` handling in `/api/summarize-hybrid` before provider-key checks so deterministic SSE behavior can be validated with no external API keys.
- Mock success payload must include `timings` + `debug.mockMode`; verifier now asserts this contract and enforces first-event + done deadlines.
- `test-youtube-hybrid.js` now supports a fast SSE verifier mode (`--expect-first-event-ms`, `--expect-done-ms`) that avoids loading provider-dependent YouTube helper modules.

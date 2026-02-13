# Issues

- Render start command likely broken (`render.yaml` uses `node server/index.js` but repo does not emit server JS; `tsconfig.json` has `noEmit: true`).

- Scope drift occurred in Task 1: an unintended dependency (`yaml-language-server`) and lockfile churn were introduced, plus unrelated `server/app.ts` cleanup/refactor changes.
- Reverted out-of-scope edits by restoring `package.json`, restoring `bun.lock`, restoring `.sisyphus/boulder.json`, and trimming `server/app.ts` back to Task 1 mock-mode + SSE-header changes while keeping prior production race behavior.

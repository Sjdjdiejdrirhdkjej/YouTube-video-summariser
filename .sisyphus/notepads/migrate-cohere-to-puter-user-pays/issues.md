## 2026-02-14 - Cohere/COHERE_API_KEY scan (docs/scripts/env + manifests/lockfiles)

### Scope covered
- Searched for: `COHERE`, `Cohere`, `cohere-ai`, `command-a`, and lowercase `cohere`.
- Checked required files explicitly: `README.md`, `DEPLOYMENT.md`, `.env.example`, `CHANGELOG.md`, `package.json`.
- Included script + lockfile checks (per requirement): `test-youtube-hybrid.js`, `package-lock.json`, `bun.lock`.

### Matches found (exact files + snippets)

#### Documentation
- `README.md`
  - `COHERE_API_KEY=your_cohere_api_key`
  - `` `COHERE_API_KEY`: Required for `/api/summarize-hybrid` (uses command-a-reasoning-08-2025) and chat functionality ``
  - `` `POST /api/summarize-hybrid` - Summarize using Cohere with video metadata (3 credits) ``
- `DEPLOYMENT.md`
  - `` `COHERE_API_KEY` - For Cohere AI summarization and chat ``
  - `Add COHERE_API_KEY: Get from Cohere Dashboard`
  - `railway variables set COHERE_API_KEY=your_key_here`
  - Env table includes: `COHERE_API_KEY | Cohere API key for hybrid summarization and chat | Yes`
- `CHANGELOG.md`
  - Multiple Unreleased entries mention Cohere and `command-a(-reasoning-08-2025)`.
- `replit.md` (repo context doc)
  - Mentions Cohere architecture, `COHERE_API_KEY`, and `cohere-ai` package.
- `QWEN.md` (repo context doc)
  - Mentions Cohere model usage, `.env` example with `COHERE_API_KEY`, and `cohere-ai`.

#### Scripts / verifier
- `test-youtube-hybrid.js`
  - Cohere-coupled payload expectation still present:
    - `assert(typeof finalPayload.timings.cohereMs === 'number', 'timings.cohereMs missing');`
  - Also still expects credits:
    - `assert(typeof finalPayload.credits === 'number', 'Final payload missing credits');`

#### Env files
- `.env.example`
  - **No Cohere/COHERE_API_KEY mention found** (only `GEMINI_API_KEY`).

#### Manifests / lockfiles
- `package.json`
  - Dependency still present: `"cohere-ai": "^7.20.0"`
- `package-lock.json`
  - Root deps contain `"cohere-ai": "^7.20.0"`
  - Resolved package entries for `cohere-ai@7.20.0`
- `bun.lock`
  - Dependency entries for `cohere-ai@7.20.0`

#### Deployment config (non-doc but env surface)
- `render.yaml`
  - `envVars` still includes `COHERE_API_KEY`

### Task mapping (Task 1 vs Task 6)
- **Task 1 (Remove Cohere from backend runtime + deps)**
  - `package.json` (`cohere-ai` dependency)
  - `package-lock.json` / `bun.lock` (`cohere-ai` lock entries)
  - `render.yaml` (`COHERE_API_KEY` deployment env var)
- **Task 6 (Update verification script(s) and documentation)**
  - `test-youtube-hybrid.js` (remove `credits` + `timings.cohereMs` expectations; verify prompt-builder contract)
  - `README.md`, `DEPLOYMENT.md`, `CHANGELOG.md` (remove/update Cohere references)
  - `.env.example` already appears aligned for Cohere removal (no change needed unless new Puter vars are introduced)

### Notable inconsistency discovered
- `README.md` instructs adding `COHERE_API_KEY`, but `.env.example` does not include it.


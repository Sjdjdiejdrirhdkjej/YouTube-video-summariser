# Video Summarizer App

React + TypeScript + Vite app to summarize YouTube videos using AI.

## Setup

```bash
npm install
npm run dev
```

## Features

- Summarize YouTube videos using Puter.js v2 AI (500+ models including Claude, GPT, Gemini)
- Chat with the video summary
- Dark/light theme
- Responsive UI
- Share summary links
- Credits-based rate limiting (500 free credits per device)

## Configuration

Copy `.env.example` to `.env` and configure:

```
PUTER_AUTH_TOKEN=your_puter_auth_token
```

- `PUTER_AUTH_TOKEN`: Required for server-side AI (obtain via `node setup-puter-auth.js`)
- Client-side AI uses Puter.js v2 directly (user-pays model, no server API key needed)

## API Endpoints

- `POST /api/summarize` - Summarize using Gemini (5 credits)
- `POST /api/summarize-hybrid` - Gather video signals and build prompt for client-side AI summarization
- `POST /api/chat` - Chat about a summary (1 credit)
- `GET /api/summary/:id` - Retrieve a shared summary
- `GET /api/chat/:id` - Retrieve a shared chat

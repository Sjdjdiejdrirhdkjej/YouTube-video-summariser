# Video Summarizer App

React + TypeScript + Vite app to summarize YouTube videos using AI.

## Setup

```bash
npm install
npm run dev
```

## Features

- Summarize YouTube videos using Gemini or Cohere AI models
- Chat with the video summary
- Dark/light theme
- Responsive UI
- Share summary links
- Credits-based rate limiting (500 free credits per device)

## Configuration

Copy `.env.example` to `.env` and add your API keys:

```
GEMINI_API_KEY=your_gemini_api_key
COHERE_API_KEY=your_cohere_api_key
```

- `GEMINI_API_KEY`: Required for `/api/summarize` (uses gemini-2.0-flash-exp)
- `COHERE_API_KEY`: Required for `/api/summarize-hybrid` (uses command-a-03-2025) and chat functionality

## API Endpoints

- `POST /api/summarize` - Summarize using Gemini (5 credits)
- `POST /api/summarize-hybrid` - Summarize using Cohere with video metadata (3 credits)
- `POST /api/chat` - Chat about a summary (1 credit)
- `GET /api/summary/:id` - Retrieve a shared summary
- `GET /api/chat/:id` - Retrieve a shared chat

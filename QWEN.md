# Video Summarizer Application - Development Context

## Project Overview

The Video Summarizer is a full-stack web application built with React, TypeScript, and Vite for the frontend, and Express.js for the backend. It enables users to paste YouTube video URLs and receive AI-generated summaries using Puter.js v2 AI (500+ models including Claude, GPT, Gemini). The application features a hybrid summarization approach that combines multiple signals (transcripts, metadata, chapters, comments) for more comprehensive summaries.

### Key Technologies
- **Frontend**: React 18, TypeScript, Vite
- **Backend**: Node.js, Express.js
- **AI Models**: Puter.js v2 AI (Claude, GPT, Gemini, and 500+ more), Google Gemini (direct video processing)
- **Additional Libraries**: marked (Markdown parsing), @heyputer/puter.js, @google/generative-ai
- **Styling**: CSS with theme support

### Architecture
The application follows a client-server architecture:
- **Frontend**: React application with streaming summary display
- **Backend**: Express API server with endpoints for summarization, chat, and data persistence
- **Data Storage**: In-memory storage (Maps) for summaries, chats, and user credits (note: ephemeral in current implementation)

## Building and Running

### Prerequisites
- Node.js (v18 or later recommended)
- npm or bun
- Puter.js v2 auth token (optional for server-side; client uses user-pays model)

### Setup
1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   # or
   bun install
   ```
3. Copy `.env.example` to `.env` and add your API keys:
   ```
   GEMINI_API_KEY=your_gemini_api_key
   PUTER_AUTH_TOKEN=your_puter_auth_token
   ```
4. Run the development server:
   ```bash
   npm run dev
   # or
   bun run dev
   ```

### Development Scripts
- `npm run dev` - Starts both client and server in development mode
- `npm run dev:client` - Starts only the Vite client
- `npm run dev:server` - Starts only the Express server
- `npm run build` - Builds the production version
- `npm run preview` - Previews the production build

### API Endpoints
- `POST /api/summarize` - Summarize using Gemini (5 credits)
- `POST /api/summarize-hybrid` - Gather video signals and build prompt for client-side AI summarization
- `POST /api/chat` - Chat about a summary (1 credit)
- `GET /api/summary/:id` - Retrieve a shared summary
- `GET /api/chat/:id` - Retrieve a shared chat
- `GET /api/credits` - Get current credit balance
- `GET /api/my-summaries` - List user's summaries
- `GET /api/my-chats` - List user's chats
- `GET /api/changelog` - Get changelog content
- `GET /api/health` - Health check

## Development Conventions

### Credit System
- Each device/IP gets 500 free credits
- Summarization costs: Standard (5 credits), Hybrid (3 credits), Chat (1 credit)
- Credits are tracked using browser fingerprints stored in localStorage

### Frontend Patterns
- Uses React hooks for state management
- Implements streaming text display with animation frames
- Client-side SSE (Server-Sent Events) parsing for real-time updates
- Theme switching with localStorage persistence
- Responsive design with CSS

### Backend Patterns
- SSE streaming for real-time AI responses
- Parallel signal gathering for hybrid summarization
- Rate limit handling with retry-after headers
- Client disconnection handling with AbortController
- In-memory data persistence (Maps)

### Error Handling
- Comprehensive error handling for API calls
- Graceful degradation when individual signals fail
- Rate limit detection and client-side countdown timers
- Proper cleanup on component unmount and request cancellation

### Code Style
- TypeScript with strict null checks
- ESLint and Prettier for consistent formatting
- Component-based architecture
- Separation of concerns between UI and business logic
- Proper cleanup of resources (animation frames, event listeners)

## Key Features

### Video Summarization
- Two summarization modes: Direct Gemini video processing and hybrid fusion
- Real-time streaming of AI responses
- Support for multiple YouTube URL formats

### Hybrid Fusion Approach
- Combines multiple signals: transcript, metadata, chapters, comments
- Parallel fetching of all available signals
- Graceful degradation when individual signals fail
- Structured prompts that leverage all available information

### Chat Functionality
- Context-aware chat using video summaries
- Persistent conversations with unique IDs
- Real-time streaming responses

### Sharing Capabilities
- Unique IDs for summaries and chats
- Shareable links for generated content
- Browser fingerprint-based persistence

### User Experience
- Real-time credit tracking
- Loading indicators and error messaging
- Sample video URLs for quick testing
- Theme switching (light/dark mode)

## Deployment Options

The application supports deployment to various platforms:
- Vercel (recommended for frontend)
- Render (backend hosting)
- Railway (alternative platform)
- Docker deployment (included Dockerfile)

Note: Current implementation uses in-memory storage which means data is ephemeral across deployments/restarts. For production use, a persistent database would be required.

## Testing

The project includes test files for verifying AI integrations:
- `test-modelfarm.js` - Tests Replit AI Model Farm integration
- `test-modelfarm-audio.js` - Audio-related AI tests
- `test-youtube-hybrid.js` - YouTube hybrid functionality tests

## Project Structure

```
├── public/                 # Static assets
├── server/                 # Backend implementation
│   ├── app.ts             # Main Express app
│   ├── index.ts           # Server startup
│   └── youtube.ts         # YouTube signal extraction
├── src/                   # Frontend source
│   ├── components/        # React components
│   ├── App.tsx            # Main application component
│   ├── index.tsx          # Entry point
│   └── theme.tsx          # Theme context
├── package.json           # Dependencies and scripts
├── vite.config.js         # Vite configuration
├── Dockerfile             # Docker configuration
└── ...
```
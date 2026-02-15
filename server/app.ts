import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const cwd = process.cwd();

const envPaths = [
  path.resolve(cwd, '.env'),
  path.resolve(projectRoot, '.env'),
  path.resolve(cwd, '.env.local'),
  path.resolve(projectRoot, '.env.local'),
];

for (const envPath of envPaths) {
   const result = dotenv.config({ path: envPath });
   if (result.error) {
     console.warn('[env] load failed:', envPath, result.error.message);
   }
 }

const envFilePaths = process.env.ENV_FILE
  ? [path.resolve(process.env.ENV_FILE)]
  : [path.resolve(cwd, '.env'), path.resolve(projectRoot, '.env')];



import express from 'express';
import cors from 'cors';
import { gatherSignals, buildFusionPrompt, extractVideoId, type VideoSignals } from './youtube.js';

const app = express();
app.use(cors());
app.use(express.json());

interface SavedSummary {
  id: string;
  videoUrl: string;
  summary: string;
  sources?: string[];
  createdAt: number;
}

const savedSummaries = new Map<string, SavedSummary>();
const summaryCache = new Map<string, { summary: string; createdAt: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

interface SavedChat {
  id: string;
  summaryId: string | null;
  videoUrl: string;
  summary: string;
  messages: Array<{ role: string; content: string }>;
  createdAt: number;
  updatedAt: number;
}

const savedChats = new Map<string, SavedChat>();

function generateSummaryId(): string {
  return crypto.randomBytes(4).toString('hex');
}

function isValidYoutubeUrl(url: string): boolean {
  return /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/.test(url);
}

function toSourceList(signals: VideoSignals): string[] {
  return [
    signals.transcript ? 'transcript' : null,
    signals.oembed ? 'oembed' : null,
    signals.metadata?.description ? 'description' : null,
    signals.metadata?.chapters?.length ? 'chapters' : null,
    signals.metadata?.tags?.length ? 'tags' : null,
    signals.comments.length ? 'comments' : null,
  ].filter(Boolean) as string[];
}



function writeProgress(res: any, step: string, message: string): boolean {
  if (res.writableEnded) return false;
  const timestamp = Date.now();
  res.write(`data: ${JSON.stringify({ progress: { step, message, timestamp } })}\n\n`);
  (res as any).flush?.();
  return true;
}

function startProgressHeartbeat(res: any, label = 'Still processing'): () => void {
  const startedAt = Date.now();
  const interval = setInterval(() => {
    if (res.writableEnded) {
      clearInterval(interval);
      return;
    }
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    writeProgress(res, 'processing', `${label}... (${elapsed}s)`);
  }, 2500);

  return () => clearInterval(interval);
}

function setupSSEHeaders(res: any): void {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.write(': ok\n\n');
  (res as any).flush?.();
}

app.post('/api/summarize-hybrid', async (req, res) => {
  let videoUrl = '';
  let stopHeartbeat: (() => void) | null = null;

  try {
    videoUrl = req.body.videoUrl;
    if (!videoUrl || typeof videoUrl !== 'string') {
      res.status(400).json({ error: 'videoUrl is required' });
      return;
    }

    if (!isValidYoutubeUrl(videoUrl)) {
      res.status(400).json({ error: 'Invalid YouTube video URL' });
      return;
    }

    const mockMode = process.env.SUMMA_MOCK_MODE?.trim();
    if (mockMode) {
      setupSSEHeaders(res);
      writeProgress(res, 'start', 'Initializing prompt build...');

      if (mockMode === 'stall_after_headers' || mockMode === 'stall_after_first_progress') {
        return;
      }

      if (mockMode === 'error') {
        res.write(`data: ${JSON.stringify({ error: 'Mock summarize-hybrid error.' })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      if (mockMode === 'success') {
        const mockPrompt = 'You are given video metadata and transcript excerpts. Produce a concise markdown summary with key points and notable timestamps.';
        res.write(`data: ${JSON.stringify({ prompt: mockPrompt, sources: ['mock'], videoUrl, debug: { mockMode } })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      res.write(`data: ${JSON.stringify({ error: `Unknown SUMMA_MOCK_MODE: ${mockMode}` })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    setupSSEHeaders(res);
    writeProgress(res, 'start', 'Initializing summarization...');
    stopHeartbeat = startProgressHeartbeat(res);
    writeProgress(res, 'validating', 'Validating video URL...');

    const abortController = new AbortController();
    req.on('close', () => abortController.abort());

    const abortCheck = () => {
      stopHeartbeat?.();
      stopHeartbeat = null;
      return;
    };

    if (abortController.signal.aborted) {
      abortCheck();
      return;
    }

    writeProgress(res, 'analyzing', 'Analyzing video content...');
    writeProgress(res, 'gathering', 'Gathering video signals...');
    writeProgress(res, 'metadata', 'Fetching metadata & transcript...');

    let signals: VideoSignals;
    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Request timed out after 20 seconds')), 20000)
      );
      signals = await Promise.race([gatherSignals(videoUrl), timeoutPromise]);
    } catch (e) {
      console.error('Signal gathering failed, constructing minimal signals:', e);
      const videoId = extractVideoId(videoUrl) || 'unknown';
      signals = {
        videoId,
        videoUrl,
        oembed: null,
        metadata: null,
        transcript: null,
        comments: [],
        missing: { all: e instanceof Error ? e.message : String(e) },
      };
    }

    if (abortController.signal.aborted) {
      abortCheck();
      return;
    }

    // Report progress: analyzing content
    if (signals.transcript) {
      const transcriptLength = signals.transcript.text.length;
      const lengthInfo = transcriptLength > 10000 ? ` (${Math.round(transcriptLength/1000)}k chars)` : '';
      writeProgress(res, 'transcript', `Transcript loaded: ${signals.transcript.segmentCount} segments${lengthInfo}`);
    } else {
      writeProgress(res, 'transcript', 'No transcript available - using metadata only');
    }

    if (signals.metadata?.chapters?.length) {
      writeProgress(res, 'chapters', `${signals.metadata.chapters.length} chapters found`);
    }

    if (signals.metadata?.description) {
      const descLen = signals.metadata.description.length;
      writeProgress(res, 'description', `Description loaded (${descLen} chars)`);
    }

    if (signals.comments.length) {
      writeProgress(res, 'comments', `${signals.comments.length} comments loaded`);
    }

    if (Object.keys(signals.missing).length > 0) {
      const missingList = Object.keys(signals.missing).join(', ');
      writeProgress(res, 'missing', `Unavailable: ${missingList}`);
    }

    if (abortController.signal.aborted) {
      abortCheck();
      return;
    }

    const signalList = toSourceList(signals);
    const prompt = buildFusionPrompt(signals);

    writeProgress(res, 'prompt', 'Prompt assembled from gathered signals.');
    writeProgress(res, 'complete', 'Prompt ready!');
    res.write(`data: ${JSON.stringify({
      prompt,
      sources: signalList,
      videoUrl,
    })}\n\n`);
    stopHeartbeat?.();
    stopHeartbeat = null;
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    stopHeartbeat?.();
    stopHeartbeat = null;
    if ((err as any)?.name === 'AbortError') {
      if (!res.writableEnded) res.end();
      return;
    }
    console.error('Hybrid summarize error:', err);

    let message = err instanceof Error ? err.message : String(err);

    if (message.includes('Network error') || message.includes('ENOTFOUND') || message.includes('ECONNREFUSED')) {
      message = 'Network error accessing YouTube. Please try a different video.';
    }

    if (res.headersSent && !res.writableEnded) {
      res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
      res.end();
    } else if (!res.headersSent) {
      res.status(500).json({ error: message });
    }
  }
});

app.post('/api/summary', (req, res) => {
  const { videoUrl, summary, sources } = req.body;

  if (!videoUrl || typeof videoUrl !== 'string') {
    res.status(400).json({ error: 'videoUrl is required' });
    return;
  }

  if (!summary || typeof summary !== 'string') {
    res.status(400).json({ error: 'summary is required' });
    return;
  }

  const summaryId = generateSummaryId();
  const normalizedSources = Array.isArray(sources)
    ? sources.filter((source): source is string => typeof source === 'string' && source.length > 0)
    : undefined;

  savedSummaries.set(summaryId, {
    id: summaryId,
    videoUrl,
    summary,
    sources: normalizedSources,
    createdAt: Date.now(),
  });

  const cacheKey = extractVideoId(videoUrl) || videoUrl;
  summaryCache.set(cacheKey, { summary, createdAt: Date.now() });

  res.json({ summaryId });
});

app.post('/api/chat', (req, res) => {
  const { videoUrl, summary, messages } = req.body;

  if (!videoUrl || typeof videoUrl !== 'string') {
    res.status(400).json({ error: 'videoUrl is required' });
    return;
  }

  if (typeof summary !== 'string') {
    res.status(400).json({ error: 'summary is required' });
    return;
  }

  if (!Array.isArray(messages)) {
    res.status(400).json({ error: 'messages must be an array' });
    return;
  }

  const normalizedMessages = messages
    .filter((message: unknown) => {
      if (typeof message !== 'object' || message === null) return false;
      const candidate = message as { role?: unknown; content?: unknown };
      return typeof candidate.role === 'string' && typeof candidate.content === 'string';
    })
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));

  if (!normalizedMessages.length) {
    res.status(400).json({ error: 'messages must include at least one valid message' });
    return;
  }

  const chatId = generateSummaryId();
  savedChats.set(chatId, {
    id: chatId,
    summaryId: null,
    videoUrl,
    summary,
    messages: normalizedMessages,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  res.json({ chatId });
});

app.get('/api/chat/:id', (req, res) => {
  const entry = savedChats.get(req.params.id);
  if (!entry) {
    res.status(404).json({ error: 'Chat not found' });
    return;
  }
  res.json({
    id: entry.id,
    videoUrl: entry.videoUrl,
    summary: entry.summary,
    messages: entry.messages,
    createdAt: entry.createdAt,
  });
});

app.get('/api/summary/:id', (req, res) => {
  const entry = savedSummaries.get(req.params.id);
  if (!entry) {
    res.status(404).json({ error: 'Summary not found' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.write(': ok\n\n');
  (res as any).flush?.();

  const abortController = new AbortController();
  req.on('close', () => abortController.abort());

  const writeSSE = (obj: unknown): boolean => {
    if (res.writableEnded || abortController.signal.aborted) return false;
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
    (res as any).flush?.();
    return true;
  };

  // Send initial metadata
  writeSSE({ id: entry.id, videoUrl: entry.videoUrl, summary: '', sources: entry.sources, createdAt: entry.createdAt });

  // Stream the summary in chunks
  const text = entry.summary;
  const chunkSize = 100;
  let index = 0;

  const streamNextChunk = () => {
    if (abortController.signal.aborted || res.writableEnded) return;

    if (index < text.length) {
      const chunk = text.slice(index, index + chunkSize);
      index += chunkSize;
      writeSSE({ summary: chunk });
      // Small delay between chunks for better streaming effect
      setTimeout(streamNextChunk, 10);
    } else {
      // Send [DONE] when finished
      res.write('data: [DONE]\n\n');
      res.end();
    }
  };

  streamNextChunk();
});

app.get('/api/changelog', async (_req, res) => {
  try {
    const changelogPath = path.resolve(projectRoot, 'CHANGELOG.md');
    const content = fs.readFileSync(changelogPath, 'utf8');
    res.json({ content });
  } catch {
    res.status(404).json({ error: 'Changelog not found' });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
  });
});

const distPath = path.resolve(projectRoot, 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('/{*splat}', (req, res) => {
    if (req.path.startsWith('/api')) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

export { app };

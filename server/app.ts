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
import { CohereClientV2 } from 'cohere-ai';
import { gatherSignals, buildFusionPrompt, extractVideoId, type VideoSignals } from './youtube.js';

const app = express();
app.use(cors());
app.use(express.json());

const fpCredits = new Map<string, number>();
const FREE_CREDITS = 500;

function getCredits(fp: string): number {
  if (!fpCredits.has(fp)) return FREE_CREDITS;
  return fpCredits.get(fp)!;
}

function deductCredits(fp: string, amount: number): boolean {
  const current = getCredits(fp);
  if (current < amount) return false;
  fpCredits.set(fp, current - amount);
  return true;
}

function refundCredits(fp: string, amount: number): void {
  const current = getCredits(fp);
  fpCredits.set(fp, current + amount);
}

interface SavedSummary {
  id: string;
  fingerprint: string;
  videoUrl: string;
  summary: string;
  createdAt: number;
}

const savedSummaries = new Map<string, SavedSummary>();
const summaryCache = new Map<string, { summary: string; createdAt: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

interface SavedChat {
  id: string;
  fingerprint: string;
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

function getFingerprint(req: express.Request): string | null {
  const fp = req.headers['x-fingerprint'];
  if (typeof fp === 'string' && fp.length > 0) return fp;
  return null;
}

const COHERE_API_KEY = process.env.COHERE_API_KEY?.trim() || undefined;

function isRateLimitError(err: unknown): { limited: boolean; retryAfter: number } {
  const e = err as any;
  const status = e?.status || e?.statusCode || e?.response?.status;
  const message = e?.message || '';
  if (status === 429 || /rate.?limit|too many requests|quota/i.test(message)) {
    const headerRetry = Number(e?.headers?.['retry-after'] || e?.response?.headers?.['retry-after']);
    const retryAfter = headerRetry > 0 ? headerRetry : 30;
    return { limited: true, retryAfter };
  }
  return { limited: false, retryAfter: 0 };
}

function handleRateLimit(res: any, err: unknown): boolean {
  const { limited, retryAfter } = isRateLimitError(err);
  if (!limited) return false;
  const message = `Rate limit reached. Please try again in ${retryAfter} seconds.`;
  if (!res.headersSent) {
    res.status(429).json({ error: message, retryAfter });
  } else if (!res.writableEnded) {
    res.write(`data: ${JSON.stringify({ error: message, retryAfter })}\n\n`);
    res.end();
  }
  return true;
}

function isValidYoutubeUrl(url: string): boolean {
  return /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/.test(url);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function extractCohereContent(content: unknown): { thinking?: string; text?: string } {
  if (typeof content === 'string') {
    return { text: content };
  }

  if (Array.isArray(content)) {
    let thinking = '';
    let text = '';

    for (const item of content) {
      const extracted = extractCohereContent(item);
      if (extracted.thinking) thinking += extracted.thinking;
      if (extracted.text) text += extracted.text;
    }

    return {
      thinking: thinking || undefined,
      text: text || undefined,
    };
  }

  if (!isRecord(content)) {
    return {};
  }

  const thinking = content.thinking;
  const text = content.text;

  return {
    thinking: typeof thinking === 'string' ? thinking : undefined,
    text: typeof text === 'string' ? text : undefined,
  };
}

function extractCohereDelta(event: unknown): { thinking?: string; text?: string } {
  if (!isRecord(event)) return {};
  const delta = event.delta;
  if (!isRecord(delta)) return {};
  const message = delta.message;
  if (!isRecord(message)) return {};
  return extractCohereContent(message.content);
}

function buildSignalFallbackSummary(signals: VideoSignals): string {
  const sections: string[] = [];

  if (signals.oembed?.title) {
    sections.push(`# ${signals.oembed.title}`);
    if (signals.oembed.authorName) {
      sections.push(`By ${signals.oembed.authorName}`);
    }
  }

  if (signals.metadata?.description) {
    sections.push(`## Overview\n\n${signals.metadata.description.slice(0, 1600)}`);
  }

  if (signals.metadata?.tags?.length) {
    sections.push(`**Topics:** ${signals.metadata.tags.slice(0, 15).join(', ')}`);
  }

  if (signals.metadata?.chapters?.length) {
    const chapterLines = signals.metadata.chapters
      .slice(0, 10)
      .map((chapter) => {
        const minutes = Math.floor(chapter.time / 60);
        const seconds = String(chapter.time % 60).padStart(2, '0');
        return `- ${minutes}:${seconds} ${chapter.title}`;
      })
      .join('\n');

    sections.push(`## Chapters\n\n${chapterLines}`);
  }

  if (signals.transcript?.text) {
    sections.push(`## Transcript Excerpt\n\n${signals.transcript.text.slice(0, 3000)}`);
  }

  if (signals.comments.length) {
    const commentLines = signals.comments
      .slice(0, 3)
      .map((comment) => `- ${comment.text}`)
      .join('\n');

    sections.push(`## Top Comments\n\n${commentLines}`);
  }

  if (!sections.length) {
    sections.push(
      `# Video Summary\n\n` +
      `This is a YouTube video (${signals.videoUrl}).\n\n` +
      `We were unable to extract detailed information for an AI-generated summary. ` +
      `The video may have restricted access, disabled captions, or limited metadata available.`
    );
  }

  return sections.join('\n\n').trim();
}

app.get('/api/credits', (req, res) => {
  const fp = getFingerprint(req);
  if (!fp) {
    res.json({ credits: FREE_CREDITS, costPerCredit: 0.01 });
    return;
  }
  res.json({ credits: getCredits(fp), costPerCredit: 0.01 });
});



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
  let fp: string | null = null;
  let videoUrl = '';
  let summaryId: string | undefined;
  let stopHeartbeat: (() => void) | null = null;

  try {
    fp = getFingerprint(req);
    if (!fp) {
      res.status(400).json({ error: 'Missing fingerprint header.' });
      return;
    }
    if (!deductCredits(fp, 5)) {
      res.status(403).json({ error: 'No credits remaining. Each device gets 500 free credits.', credits: getCredits(fp) });
      return;
    }
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

      if (mockMode === 'stall_after_headers') {
        return;
      }

      writeProgress(res, 'start', 'Initializing summarization...');

      if (mockMode === 'stall_after_first_progress') {
        return;
      }

      stopHeartbeat = startProgressHeartbeat(res);

      if (mockMode === 'error') {
        stopHeartbeat?.();
        stopHeartbeat = null;
        res.write(`data: ${JSON.stringify({ error: 'Mock summarize-hybrid error.', credits: getCredits(fp) })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      if (mockMode === 'success') {
        writeProgress(res, 'processing', 'Running deterministic mock summarization...');
        summaryId = generateSummaryId();
        const mockSummary = '## Mock Summary\n\n- Deterministic mock mode is active.\n- SSE framing and completion sentinel were emitted.\n- No external AI providers were called.';
        const cacheKey = extractVideoId(videoUrl) || videoUrl;

        savedSummaries.set(summaryId, {
          id: summaryId,
          fingerprint: fp,
          videoUrl,
          summary: mockSummary,
          createdAt: Date.now(),
        });
        summaryCache.set(cacheKey, { summary: mockSummary, createdAt: Date.now() });

        res.write(`data: ${JSON.stringify({
          summary: mockSummary,
          summaryId,
          credits: getCredits(fp),
          sources: ['mock'],
          timings: {
            totalMs: 0,
            cacheMs: 0,
            directMs: 0,
            signalsMs: 0,
            cohereMs: 0,
            geminiTextMs: 0,
          },
          debug: { mockMode },
        })}\n\n`);
        stopHeartbeat?.();
        stopHeartbeat = null;
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      stopHeartbeat?.();
      stopHeartbeat = null;
      res.write(`data: ${JSON.stringify({ error: `Unknown SUMMA_MOCK_MODE: ${mockMode}` })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    if (!COHERE_API_KEY) {
      refundCredits(fp, 5);
      res.status(500).json({
        error: 'Summarization is not configured. Set COHERE_API_KEY.',
      });
      return;
    }

    setupSSEHeaders(res);
    writeProgress(res, 'start', 'Initializing summarization...');
    stopHeartbeat = startProgressHeartbeat(res);
    writeProgress(res, 'validating', 'Validating video URL...');

    // Check cache first
    const cacheKey = extractVideoId(videoUrl) || videoUrl;
    const cached = summaryCache.get(cacheKey);
    if (cached && Date.now() - cached.createdAt < CACHE_TTL) {
      summaryId = generateSummaryId();
      savedSummaries.set(summaryId, {
        id: summaryId,
        fingerprint: fp,
        videoUrl,
        summary: cached.summary,
        createdAt: Date.now(),
      });
      writeProgress(res, 'complete', 'Summary ready!');
      res.write(`data: ${JSON.stringify({ summary: cached.summary, summaryId, credits: getCredits(fp), sources: ['cache'] })}\n\n`);
      stopHeartbeat?.();
      stopHeartbeat = null;
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    summaryId = generateSummaryId();
    let fullText = '';
    let thinkingText = '';

    const abortController = new AbortController();
    req.on('close', () => abortController.abort());

    // Gather video data (transcript, metadata, etc.) for hybrid analysis
    if (!abortController.signal.aborted) {
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
        stopHeartbeat?.();
        stopHeartbeat = null;
        return;
      }

      const signalList = [
        signals.transcript ? 'transcript' : null,
        signals.oembed ? 'metadata' : null,
        signals.metadata?.description ? 'description' : null,
        signals.metadata?.chapters?.length ? 'chapters' : null,
        signals.metadata?.tags?.length ? 'tags' : null,
        signals.comments.length ? 'comments' : null,
      ].filter(Boolean) as string[];

      const prompt = buildFusionPrompt(signals);
      writeProgress(res, 'processing', 'Synthesizing summary with AI...');

      // Stream thinking in real-time during generation
      let streamedThinking = '';
      let currentStep = 'processing';
      let stepSent = { analyzing: true, processing: true, reasoning: false, drafting: false, refining: false };

      const updateStep = (newStep: string) => {
        if (!stepSent[newStep as keyof typeof stepSent]) {
          stepSent[newStep as keyof typeof stepSent] = true;
          currentStep = newStep;
          const messages: Record<string, string> = {
            reasoning: 'Extracting key information...',
            drafting: 'Drafting summary...',
            refining: 'Refining and formatting...',
          };
          writeProgress(res, newStep, messages[newStep] || '');
        }
      };

      const streamThinking = (thinking: string) => {
        if (!thinking) return;
        streamedThinking += thinking;
        
        // Progress through stages based on thinking length
        if (streamedThinking.length > 100 && !stepSent.reasoning) {
          updateStep('reasoning');
        }
        if (streamedThinking.length > 400 && !stepSent.drafting) {
          updateStep('drafting');
        }
        if (streamedThinking.length > 1000 && !stepSent.refining) {
          updateStep('refining');
        }
        
        if (res.writableEnded || abortController.signal.aborted) return;
        res.write(`data: ${JSON.stringify({ progress: { step: 'thinking', thinking } })}\n\n`);
        (res as any).flush?.();
      };

      try {
        const cohere = new CohereClientV2({ token: COHERE_API_KEY });
        writeProgress(res, 'reasoning', 'AI is analyzing and reasoning...');
        const stream = await cohere.chatStream({
          model: 'command-a-reasoning-08-2025',
          messages: [{ role: 'user', content: prompt }],
          thinking: { type: 'enabled', tokenBudget: 4096 },
        });
        for await (const event of stream) {
          if (abortController.signal.aborted) break;
          if (event.type === 'content-delta') {
            const { thinking, text } = extractCohereDelta(event);

            if (thinking) {
              streamThinking(thinking);
            }

            if (text) {
              fullText += text;
              if (!stepSent.drafting) {
                updateStep('drafting');
              }
            }
          }
        }
      } catch (llmErr) {
        console.error('Cohere summarization failed, will use fallbacks:', llmErr);
      }

      // Store streamed thinking for final response
      thinkingText = streamedThinking;

      if (abortController.signal.aborted) {
        stopHeartbeat?.();
        stopHeartbeat = null;
        return;
      }

      // Final fallback if still no summary
      if (!fullText.trim()) {
        fullText = buildSignalFallbackSummary(signals);
      }

      savedSummaries.set(summaryId, {
        id: summaryId,
        fingerprint: fp,
        videoUrl,
        summary: fullText,
        createdAt: Date.now(),
      });
      summaryCache.set(cacheKey, { summary: fullText, createdAt: Date.now() });

      // Report completion
      writeProgress(res, 'complete', 'Summary ready!');

      // Send final response via SSE
      res.write(`data: ${JSON.stringify({ summary: fullText, summaryId, credits: getCredits(fp), sources: signalList, thinking: thinkingText || undefined })}\n\n`);
      stopHeartbeat?.();
      stopHeartbeat = null;
      res.write('data: [DONE]\n\n');
      res.end();
    }
  } catch (err) {
    stopHeartbeat?.();
    stopHeartbeat = null;
    if ((err as any)?.name === 'AbortError') {
      if (!res.writableEnded) res.end();
      return;
    }
    if (handleRateLimit(res, err)) return;
    console.error('Hybrid summarize error:', err);

    if (fp) refundCredits(fp, 5);

    let message = err instanceof Error ? err.message : String(err);

    if (message.includes('Network error') || message.includes('ENOTFOUND') || message.includes('ECONNREFUSED')) {
      message = 'Network error accessing YouTube. Please try a different video.';
    }

    if (res.headersSent && !res.writableEnded) {
      res.write(`data: ${JSON.stringify({ error: message, credits: fp ? getCredits(fp) : undefined })}\n\n`);
      res.end();
    } else if (!res.headersSent) {
      res.status(500).json({ error: message, credits: fp ? getCredits(fp) : undefined });
    }
  }
});

app.post('/api/chat', async (req, res) => {
  try {
    const fp = getFingerprint(req);
    if (!fp) {
      res.status(400).json({ error: 'Missing fingerprint header.' });
      return;
    }
    if (!deductCredits(fp, 1)) {
      res.status(403).json({ error: 'No credits remaining. Each device gets 500 free credits.', credits: getCredits(fp) });
      return;
    }
    const { message, summary, videoUrl, history, chatId: existingChatId } = req.body;
    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    if (!COHERE_API_KEY) {
      res.status(500).json({ error: 'Chat is not configured. Set COHERE_API_KEY.' });
      return;
    }

    const chatId = existingChatId && savedChats.has(existingChatId) ? existingChatId : generateSummaryId();
    const existingChat = savedChats.get(chatId);
    const chatSummary = existingChat ? existingChat.summary : (summary || '');
    const chatVideoUrl = existingChat ? existingChat.videoUrl : (videoUrl || '');
    const chatHistory: Array<{ role: string; content: string }> = existingChat
      ? existingChat.messages
      : (Array.isArray(history) ? history.map((m: any) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content })) : []);

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write(': ok\n\n');
    (res as any).flush?.();
    res.write(`data: ${JSON.stringify({ credits: getCredits(fp) })}\n\n`);
    (res as any).flush?.();

    const abortController = new AbortController();
    req.on('close', () => abortController.abort());

    const writeSSE = (obj: unknown): boolean => {
      if (res.writableEnded || abortController.signal.aborted) return false;
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
      (res as any).flush?.();
      return true;
    };

    const cohere = new CohereClientV2({ token: COHERE_API_KEY });

    const systemPrompt = `You are a helpful assistant discussing a YouTube video. Here is the video summary for context:\n\n${chatSummary}\n\nVideo URL: ${chatVideoUrl}\n\nAnswer the user's questions based on this summary. Be concise and use markdown formatting.`;

    const chatMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
      ...chatHistory.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      { role: 'user', content: message },
    ];

    const cohereMessages: { role: 'user' | 'assistant'; content: string }[] = [
      { role: 'user', content: `${systemPrompt}\n\n${chatHistory.map(m => `${m.role}: ${m.content}`).join('\n\n')}\n\nuser: ${message}` },
    ];

    const stream = await cohere.chatStream({
      model: 'command-a-reasoning-08-2025',
      messages: cohereMessages,
      thinking: { type: 'enabled', tokenBudget: 4096 },
    });

    let fullResponse = '';
    for await (const event of stream) {
      if (abortController.signal.aborted) break;
      if (event.type === 'content-delta') {
        const { thinking, text } = extractCohereDelta(event);
        if (thinking) {
          if (!writeSSE({ thinking })) break;
        }
        if (text) {
          fullResponse += text;
          if (!writeSSE({ text })) break;
        }
      }
    }

    const updatedMessages = [...chatHistory, { role: 'user', content: message }, { role: 'assistant', content: fullResponse }];
    savedChats.set(chatId, {
      id: chatId,
      fingerprint: fp,
      summaryId: null,
      videoUrl: chatVideoUrl,
      summary: chatSummary,
      messages: updatedMessages,
      createdAt: existingChat ? existingChat.createdAt : Date.now(),
      updatedAt: Date.now(),
    });

    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ chatId })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  } catch (err) {
    if ((err as any)?.name === 'AbortError') {
      if (!res.writableEnded) res.end();
      return;
    }
    if (handleRateLimit(res, err)) return;
    console.error('Chat error:', err);
    const message = err instanceof Error ? err.message : String(err);
    if (!res.headersSent) {
      res.status(500).json({ error: message });
    } else if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
      res.end();
    }
  }
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

app.get('/api/my-chats', (req, res) => {
  const fp = getFingerprint(req);
  if (!fp) {
    res.json({ chats: [] });
    return;
  }
  const list = Array.from(savedChats.values())
    .filter((c) => c.fingerprint === fp)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(({ id, videoUrl, createdAt, updatedAt, messages }) => ({
      id,
      videoUrl,
      createdAt,
      updatedAt,
      messageCount: messages.length,
    }));
  res.json({ chats: list });
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
  writeSSE({ id: entry.id, videoUrl: entry.videoUrl, summary: '', createdAt: entry.createdAt });

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

app.get('/api/my-summaries', (req, res) => {
  const fp = getFingerprint(req);
  if (!fp) {
    res.json({ summaries: [] });
    return;
  }
  const list = Array.from(savedSummaries.values())
    .filter((s) => s.fingerprint === fp)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(({ id, videoUrl, createdAt }) => ({ id, videoUrl, createdAt }));
  res.json({ summaries: list });
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
    hasCohereKey: Boolean(COHERE_API_KEY),
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

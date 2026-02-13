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

if (!process.env.GEMINI_API_KEY?.trim()) {
  for (const envPath of envFilePaths) {
    if (!fs.existsSync(envPath)) continue;
    try {
      const content = fs.readFileSync(envPath, 'utf8');
      const match = content.match(/^\s*GEMINI_API_KEY\s*=\s*(.+?)\s*$/m);
      if (match) {
        const value = match[1].replace(/^["']|["']$/g, '').trim();
        if (value) {
          process.env.GEMINI_API_KEY = value;
          break;
        }
      }
    } catch {
      // ignore
    }
  }
}

import express from 'express';
import cors from 'cors';
import { GoogleGenAI } from '@google/genai';
import { CohereClientV2 } from 'cohere-ai';
import { OpenAI } from 'openai';
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

const GEMINI_API_KEY = process.env.GEMINI_API_KEY?.trim() || undefined;
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

app.post('/api/summarize', async (req, res) => {
  let fp: string | null = null;
  let videoUrl = '';
  let summaryId: string | undefined;

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

    if (!GEMINI_API_KEY) {
      refundCredits(fp, 5);
      res.status(500).json({
        error: 'Summarization is not configured. Set GEMINI_API_KEY.',
      });
      return;
    }

    summaryId = generateSummaryId();
    let fullText = '';

    const abortController = new AbortController();
    req.on('close', () => abortController.abort());

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    const stream = await ai.models.generateContentStream({
      model: 'gemini-2.0-flash-exp',
      contents: [
        {
          role: 'user',
          parts: [
            { fileData: { fileUri: videoUrl } },
            {
              text: 'Summarize this video in clear, concise points. Include key takeaways. Keep the summary readable and well-structured (use markdown line breaks and bullets where helpful).',
            },
          ],
        },
      ],
    });

    for await (const chunk of stream) {
      if (abortController.signal.aborted) break;
      const text = chunk.text;
      if (text) {
        fullText += text;
      }
    }

    if (abortController.signal.aborted) {
      return;
    }

    if (!fullText.trim()) {
      try {
        const signals = await gatherSignals(videoUrl);
        fullText = buildSignalFallbackSummary(signals);
      } catch (fallbackErr) {
        console.error('Signal fallback also failed:', fallbackErr);
      }
    }

    if (!fullText.trim()) {
      throw new Error('Summary generation produced no content.');
    }

    savedSummaries.set(summaryId, {
      id: summaryId,
      fingerprint: fp,
      videoUrl,
      summary: fullText,
      createdAt: Date.now(),
    });

    res.json({ summary: fullText, summaryId, credits: getCredits(fp) });
  } catch (err) {
    if ((err as any)?.name === 'AbortError') {
      return;
    }
    if (handleRateLimit(res, err)) return;
    console.error('Summarize error:', err);
    if (fp) refundCredits(fp, 5);
    const message = err instanceof Error ? err.message : String(err);
    if (!res.headersSent) {
      res.status(500).json({ error: message, credits: fp ? getCredits(fp) : undefined });
    }
  }
});

function writeProgress(res: any, step: string, message: string): boolean {
  if (res.writableEnded) return false;
  res.write(`data: ${JSON.stringify({ progress: { step, message } })}\n\n`);
  (res as any).flush?.();
  return true;
}

app.post('/api/summarize-hybrid', async (req, res) => {
  let fp: string | null = null;
  let videoUrl = '';
  let summaryId: string | undefined;

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

    if (!GEMINI_API_KEY && !COHERE_API_KEY) {
      refundCredits(fp, 5);
      res.status(500).json({
        error: 'Summarization is not configured. Set GEMINI_API_KEY and/or COHERE_API_KEY.',
      });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write(': ok\n\n');
    (res as any).flush?.();
    writeProgress(res, 'start', 'Starting summarization...');

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
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    summaryId = generateSummaryId();
    let fullText = '';
    let thinkingText = '';

    const abortController = new AbortController();
    req.on('close', () => abortController.abort());

    // Try direct video URL summarization FIRST (fastest - no need to fetch transcript/metadata)
    writeProgress(res, 'analyzing', 'Analyzing video content...');
    let directMethodSucceeded = false;
    let modelUsed = '';

    // Model fallback chain: try best models first, fall back to faster/cheaper ones
    const geminiModels = [
      'gemini-3-pro',              // Gemini 3 Pro (best quality)
      'gemini-2.5-pro',            // Gemini 2.5 Pro
      'gemini-3-flash',            // Gemini 3 Flash
      'gemini-2.5-flash',         // Gemini 2.5 Flash (most reliable)
    ];

    if (GEMINI_API_KEY) {
      const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
      
      for (const model of geminiModels) {
        if (abortController.signal.aborted) break;
        
        try {
          console.log(`Trying direct video summarization with model: ${model}`);
          const stream = await ai.models.generateContentStream({
            model,
            contents: [
              {
                role: 'user',
                parts: [
                  { fileData: { fileUri: videoUrl } },
                  {
                    text: 'Summarize this video in clear, concise points. Include key takeaways. Keep the summary readable and well-structured (use markdown line breaks and bullets where helpful).',
                  },
                ],
              },
            ],
          });

          for await (const chunk of stream) {
            if (abortController.signal.aborted) break;
            const text = chunk.text;
            if (text) {
              fullText += text;
            }
          }

          if (fullText.trim()) {
            directMethodSucceeded = true;
            modelUsed = model;
            console.log(`Direct video URL summarization succeeded with ${model}`);
            break; // Success - exit the model loop
          }
        } catch (modelErr) {
          console.error(`Model ${model} failed:`, modelErr);
          fullText = ''; // Reset for next model attempt
          // Continue to next model in the chain
        }
      }

      if (!directMethodSucceeded) {
        console.error('All Gemini models failed for direct video URL, falling back to data gathering');
      }
    }

    // If direct method succeeded, we're done! Skip the slow signal gathering
    if (directMethodSucceeded && fullText.trim() && !abortController.signal.aborted) {
      savedSummaries.set(summaryId, {
        id: summaryId,
        fingerprint: fp,
        videoUrl,
        summary: fullText,
        createdAt: Date.now(),
      });

      writeProgress(res, 'complete', 'Summary ready!');
      res.write(`data: ${JSON.stringify({ summary: fullText, summaryId, credits: getCredits(fp), sources: ['direct'], model: modelUsed, thinking: thinkingText || undefined })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    // Direct method failed or was aborted - fall back to data gathering approach
    if (!abortController.signal.aborted) {
      writeProgress(res, 'metadata', 'Fetching video information...');
      
      let signals: VideoSignals;
      
      try {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Request timed out after 30 seconds')), 30000)
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
        writeProgress(res, 'transcript', `Transcript loaded (${signals.transcript.segmentCount} segments)`);
      } else {
        writeProgress(res, 'transcript', 'No transcript available');
      }
      
      if (signals.metadata?.chapters?.length) {
        writeProgress(res, 'chapters', `${signals.metadata.chapters.length} chapters found`);
      }
      
      if (signals.comments.length) {
        writeProgress(res, 'comments', `${signals.comments.length} comments loaded`);
      }

      if (abortController.signal.aborted) {
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

      writeProgress(res, 'gathering', 'Gathering video data...');
      
      const prompt = buildFusionPrompt(signals);
      writeProgress(res, 'analyzing', 'Analyzing video content...');

      // Stream thinking in real-time during generation
      let streamedThinking = '';
      let currentStep = 'analyzing';
      let stepSent = { analyzing: true, reasoning: false, drafting: false, refining: false };

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
        if (COHERE_API_KEY) {
          try {
            const cohere = new CohereClientV2({ token: COHERE_API_KEY });
            const stream = await cohere.chatStream({
              model: 'command-a-reasoning-08-2025',
              messages: [{ role: 'user', content: prompt }],
              thinking: { type: 'enabled', tokenBudget: 8192 },
            });
            for await (const event of stream) {
              if (abortController.signal.aborted) break;
              if (event.type === 'content-delta') {
                const { thinking, text } = extractCohereDelta(event);
                if (thinking) {
                  thinkingText += thinking;
                  streamThinking(thinking);
                }
                if (text) {
                  fullText += text;
                }
              }
            }
          } catch (cohereErr) {
            console.error('Cohere failed, trying Gemini fallback:', cohereErr);
            if (GEMINI_API_KEY && !abortController.signal.aborted) {
              const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
              const geminiStream = await ai.models.generateContentStream({
                model: 'gemini-2.0-flash-exp',
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
              });
              for await (const chunk of geminiStream) {
                if (abortController.signal.aborted) break;
                const text = chunk.text;
                if (text) {
                  fullText += text;
                }
              }
            }
          }
        } else if (GEMINI_API_KEY) {
          const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
          const geminiStream = await ai.models.generateContentStream({
            model: 'gemini-2.0-flash-exp',
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
          });
          for await (const chunk of geminiStream) {
            if (abortController.signal.aborted) break;
            const text = chunk.text;
            if (text) {
              fullText += text;
            }
          }
        }
      } catch (llmErr) {
        console.error('LLM summarization failed, will use fallbacks:', llmErr);
      }

      // Store streamed thinking for final response
      thinkingText = streamedThinking;

      if (abortController.signal.aborted) {
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

      // Report completion
      writeProgress(res, 'complete', 'Summary ready!');

      // Send final response via SSE
      res.write(`data: ${JSON.stringify({ summary: fullText, summaryId, credits: getCredits(fp), sources: signalList, thinking: thinkingText || undefined })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  } catch (err) {
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
    hasGeminiKey: Boolean(GEMINI_API_KEY),
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

export { app, GEMINI_API_KEY };

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
import { gatherSignals, buildFusionPrompt } from './youtube.js';

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

interface SavedSummary {
  id: string;
  fingerprint: string;
  videoUrl: string;
  summary: string;
  createdAt: number;
}

const savedSummaries = new Map<string, SavedSummary>();

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
      res.status(500).json({
        error: 'Summarization is not configured. Set GEMINI_API_KEY.',
      });
      return;
    }

    summaryId = generateSummaryId();
    let fullText = '';

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write(': ok\n\n');
    res.write(`data: ${JSON.stringify({ credits: getCredits(fp) })}\n\n`);

    const abortController = new AbortController();
    req.on('close', () => abortController.abort());

    const writeSSE = (obj: unknown): boolean => {
      if (res.writableEnded || abortController.signal.aborted) return false;
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
      return true;
    };

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    writeSSE({ text: 'Processing video...' });

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
        if (!writeSSE({ text })) break;
      }
    }

    if (!fullText) {
      throw new Error('Summary generation produced no content.');
    }
    savedSummaries.set(summaryId, {
      id: summaryId,
      fingerprint: fp,
      videoUrl,
      summary: fullText,
      createdAt: Date.now(),
    });

    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ summaryId })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  } catch (err) {
    if ((err as any)?.name === 'AbortError') {
      if (!res.writableEnded) res.end();
      return;
    }
    if (handleRateLimit(res, err)) return;
    console.error('Summarize error:', err);
    const message = err instanceof Error ? err.message : String(err);
    if (!res.headersSent) {
      res.status(500).json({ error: message });
    } else if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
      res.end();
    }
  }
});

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
      res.status(500).json({
        error: 'Summarization is not configured. Set GEMINI_API_KEY and/or COHERE_API_KEY.',
      });
      return;
    }

    summaryId = generateSummaryId();
    let fullText = '';

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write(': ok\n\n');
    res.write(`data: ${JSON.stringify({ credits: getCredits(fp) })}\n\n`);

    const abortController = new AbortController();
    req.on('close', () => abortController.abort());

    const writeSSE = (obj: unknown): boolean => {
      if (res.writableEnded || abortController.signal.aborted) return false;
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
      return true;
    };

    writeSSE({ text: 'Analyzing video with multiple strategies...\n' });

    const geminiVideoAnalysis = async (): Promise<string | null> => {
      if (!GEMINI_API_KEY) return null;
      try {
        const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
        const result = await ai.models.generateContent({
          model: 'gemini-2.0-flash-exp',
          contents: [
            {
              role: 'user',
              parts: [
                { fileData: { fileUri: videoUrl } },
                {
                  text: 'Analyze this video thoroughly. Describe the visual content, key scenes, on-screen text, speaker expressions, demonstrations, and audio/speech content. Provide a detailed structured summary with key takeaways. Use markdown formatting.',
                },
              ],
            },
          ],
        });
        const text = result.text ?? '';
        return text || null;
      } catch (e) {
        console.warn('Gemini video analysis failed:', e instanceof Error ? e.message : String(e));
        return null;
      }
    };

    const textSignalAnalysis = async (): Promise<{ text: string | null; signalList: string[] }> => {
      try {
        const signals = await gatherSignals(videoUrl);

        const signalList = [
          signals.transcript ? 'transcript' : null,
          signals.oembed ? 'metadata' : null,
          signals.metadata?.chapters?.length ? 'chapters' : null,
          signals.comments.length ? 'comments' : null,
        ].filter(Boolean) as string[];

        if (signalList.length === 0) return { text: null, signalList: [] };

        if (!COHERE_API_KEY) {
          const metaParts: string[] = [];
          if (signals.oembed) metaParts.push(`**${signals.oembed.title}** by ${signals.oembed.authorName}`);
          if (signals.metadata?.description) metaParts.push(signals.metadata.description);
          if (signals.transcript) metaParts.push(`Transcript: ${signals.transcript.text.slice(0, 5000)}`);
          return { text: metaParts.join('\n\n') || null, signalList };
        }

        const prompt = buildFusionPrompt(signals);
        const cohere = new CohereClientV2({ token: COHERE_API_KEY });
        const stream = await cohere.chatStream({
          model: 'command-a-reasoning-08-2025',
          messages: [{ role: 'user', content: prompt }],
          thinking: { type: 'enabled', tokenBudget: 4096 },
        });

        let result = '';
        for await (const event of stream) {
          if (event.type === 'content-delta') {
            const thinking = event.delta?.message?.content?.thinking;
            if (thinking) {
              writeSSE({ thinking, source: 'text-analysis' });
            }
            const t = event.delta?.message?.content?.text;
            if (t) result += t;
          }
        }

        return { text: result || null, signalList };
      } catch (e) {
        console.warn('Text signal analysis failed:', e instanceof Error ? e.message : String(e));
        return { text: null, signalList: [] };
      }
    };

    writeSSE({ text: 'Running video AI analysis and transcript extraction in parallel...\n' });

    const [geminiResult, textResult] = await Promise.all([
      geminiVideoAnalysis(),
      textSignalAnalysis(),
    ]);

    if (abortController.signal.aborted) {
      if (!res.writableEnded) res.end();
      return;
    }

    const methods: string[] = [];
    if (geminiResult) methods.push('video AI');
    if (textResult.text) methods.push(...textResult.signalList);

    if (methods.length === 0) {
      throw new Error('Could not analyze the video with any method. The video may be unavailable or restricted.');
    }

    writeSSE({ text: `*Analysis methods: ${methods.join(', ')}*\n\n` });

    if (geminiResult && textResult.text) {
      writeSSE({ text: 'Reasoning to synthesize both analyses...\n\n---\n\n' });

      const fusionPrompt = `You have two independent analyses of the same YouTube video produced by different methods.

**Analysis 1 — Video/Audio AI Analysis (from visual and audio processing):**
${geminiResult}

**Analysis 2 — Transcript & Metadata Analysis (from text signals):**
${textResult.text}

Synthesize these into a single comprehensive markdown summary. Combine unique insights from both analyses and remove redundancy. Structure it as:
1. A concise overview paragraph
2. Key takeaways as bullet points
3. Section-by-section outline
4. Notable quotes or visual details
5. Audience sentiment (if comment data was available)`;

      if (COHERE_API_KEY) {
        const cohere = new CohereClientV2({ token: COHERE_API_KEY });
        const fusionStream = await cohere.chatStream({
          model: 'command-a-reasoning-08-2025',
          messages: [{ role: 'user', content: fusionPrompt }],
          thinking: { type: 'enabled', tokenBudget: 8192 },
        });
        for await (const event of fusionStream) {
          if (abortController.signal.aborted) break;
          if (event.type === 'content-delta') {
            const thinking = event.delta?.message?.content?.thinking;
            if (thinking) {
              if (!writeSSE({ thinking })) break;
            }
            const text = event.delta?.message?.content?.text;
            if (text) {
              fullText += text;
              if (!writeSSE({ text })) break;
            }
          }
        }
      } else if (GEMINI_API_KEY) {
        const fusionAi = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
        const fusionStream = await fusionAi.models.generateContentStream({
          model: 'gemini-2.0-flash-exp',
          contents: [{ role: 'user', parts: [{ text: fusionPrompt }] }],
        });
        for await (const chunk of fusionStream) {
          if (abortController.signal.aborted) break;
          const text = chunk.text;
          if (text) {
            fullText += text;
            if (!writeSSE({ text })) break;
          }
        }
      }
    } else if (geminiResult) {
      const singleSource = geminiResult;
      if (COHERE_API_KEY) {
        writeSSE({ text: 'Reasoning to refine analysis...\n\n---\n\n' });
        const rewritePrompt = `You have a video analysis. Rewrite it into a clean, well-structured markdown summary with:\n1. A concise overview paragraph\n2. Key takeaways as bullet points\n3. Section-by-section outline\n4. Notable quotes or visual details\n\n**Video Analysis:**\n${singleSource}`;
        const cohere = new CohereClientV2({ token: COHERE_API_KEY });
        const rewriteStream = await cohere.chatStream({
          model: 'command-a-reasoning-08-2025',
          messages: [{ role: 'user', content: rewritePrompt }],
          thinking: { type: 'enabled', tokenBudget: 4096 },
        });
        for await (const event of rewriteStream) {
          if (abortController.signal.aborted) break;
          if (event.type === 'content-delta') {
            const thinking = event.delta?.message?.content?.thinking;
            if (thinking) {
              if (!writeSSE({ thinking })) break;
            }
            const text = event.delta?.message?.content?.text;
            if (text) {
              fullText += text;
              if (!writeSSE({ text })) break;
            }
          }
        }
      } else {
        const chunkSize = 200;
        for (let i = 0; i < singleSource.length; i += chunkSize) {
          if (abortController.signal.aborted) break;
          const chunk = singleSource.slice(i, i + chunkSize);
          fullText += chunk;
          if (!writeSSE({ text: chunk })) break;
        }
      }
    } else if (textResult.text) {
      const singleSource = textResult.text;
      if (COHERE_API_KEY) {
        writeSSE({ text: 'Reasoning to refine analysis...\n\n---\n\n' });
        const rewritePrompt = `You have a video analysis from transcript and metadata. Rewrite it into a clean, well-structured markdown summary with:\n1. A concise overview paragraph\n2. Key takeaways as bullet points\n3. Section-by-section outline\n\n**Video Analysis:**\n${singleSource}`;
        const cohere = new CohereClientV2({ token: COHERE_API_KEY });
        const rewriteStream = await cohere.chatStream({
          model: 'command-a-reasoning-08-2025',
          messages: [{ role: 'user', content: rewritePrompt }],
          thinking: { type: 'enabled', tokenBudget: 4096 },
        });
        for await (const event of rewriteStream) {
          if (abortController.signal.aborted) break;
          if (event.type === 'content-delta') {
            const thinking = event.delta?.message?.content?.thinking;
            if (thinking) {
              if (!writeSSE({ thinking })) break;
            }
            const text = event.delta?.message?.content?.text;
            if (text) {
              fullText += text;
              if (!writeSSE({ text })) break;
            }
          }
        }
      } else if (GEMINI_API_KEY) {
        const rewritePrompt = `Rewrite this video analysis into a clean, well-structured markdown summary with an overview, key takeaways, and section outline:\n\n${singleSource}`;
        const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
        const rewriteStream = await ai.models.generateContentStream({
          model: 'gemini-2.0-flash-exp',
          contents: [{ role: 'user', parts: [{ text: rewritePrompt }] }],
        });
        for await (const chunk of rewriteStream) {
          if (abortController.signal.aborted) break;
          const text = chunk.text;
          if (text) {
            fullText += text;
            if (!writeSSE({ text })) break;
          }
        }
      } else {
        const chunkSize = 200;
        for (let i = 0; i < singleSource.length; i += chunkSize) {
          if (abortController.signal.aborted) break;
          const chunk = singleSource.slice(i, i + chunkSize);
          fullText += chunk;
          if (!writeSSE({ text: chunk })) break;
        }
      }
    }

    if (!fullText) {
      throw new Error('Summary generation produced no content.');
    }

    savedSummaries.set(summaryId, {
      id: summaryId,
      fingerprint: fp,
      videoUrl,
      summary: fullText,
      createdAt: Date.now(),
    });

    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ summaryId })}\n\n`);
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

    let message = err instanceof Error ? err.message : String(err);

    if (message.includes('Network error') || message.includes('ENOTFOUND') || message.includes('ECONNREFUSED')) {
      message = 'Network error accessing YouTube. Please try a different video.';
    }

    if (!res.headersSent) {
      res.status(500).json({ error: message });
    } else if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
      res.end();
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
    res.write(`data: ${JSON.stringify({ credits: getCredits(fp) })}\n\n`);

    const abortController = new AbortController();
    req.on('close', () => abortController.abort());

    const writeSSE = (obj: unknown): boolean => {
      if (res.writableEnded || abortController.signal.aborted) return false;
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
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
        const thinking = event.delta?.message?.content?.thinking;
        if (thinking) {
          if (!writeSSE({ thinking })) break;
        }
        const text = event.delta?.message?.content?.text;
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

  const abortController = new AbortController();
  req.on('close', () => abortController.abort());

  const writeSSE = (obj: unknown): boolean => {
    if (res.writableEnded || abortController.signal.aborted) return false;
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
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

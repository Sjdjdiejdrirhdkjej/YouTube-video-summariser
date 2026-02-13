import { YouTubeTranscriptApi, EnhancedYouTubeTranscriptApi, FetchedTranscript } from './youtube-transcript-simple.js';

export interface OEmbedData {
  title: string;
  authorName: string;
  authorUrl: string;
  thumbnailUrl: string;
}

export interface Chapter {
  time: number;
  title: string;
}

export interface Metadata {
  description: string;
  chapters: Chapter[];
  tags: string[];
}

export interface TranscriptData {
  available: boolean;
  text: string;
  language: string;
  segmentCount: number;
}

export interface Comment {
  text: string;
  likes: number;
}

export interface VideoSignals {
  videoId: string;
  videoUrl: string;
  oembed: OEmbedData | null;
  metadata: Metadata | null;
  transcript: TranscriptData | null;
  comments: Comment[];
  missing: Record<string, string>;
}

const FETCH_TIMEOUT = 10_000;

function timedFetch(url: string, opts?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  return fetch(url, { ...opts, signal: controller.signal })
    .catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Network error fetching ${url}: ${msg}`);
    })
    .finally(() => clearTimeout(timer));
}

export function extractVideoId(url: string): string | null {
  const match = url.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/
  );
  return match ? match[1] : null;
}

export async function fetchOEmbed(videoUrl: string): Promise<OEmbedData> {
  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(videoUrl)}&format=json`;
  const res = await timedFetch(oembedUrl);
  if (!res.ok) throw new Error(`oEmbed returned ${res.status}`);
  const data = await res.json();
  return {
    title: data.title,
    authorName: data.author_name,
    authorUrl: data.author_url,
    thumbnailUrl: data.thumbnail_url,
  };
}

export async function fetchWatchPageHtml(videoId: string): Promise<string> {
  const url = `https://www.youtube.com/watch?v=${videoId}&hl=en`;
  const res = await timedFetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`Watch page returned ${res.status}`);
  return res.text();
}

export function parseMetadataFromHtml(html: string): Metadata {
  let description = '';
  let chapters: Chapter[] = [];
  let tags: string[] = [];

  const descMatch = html.match(
    /<meta\s+name="description"\s+content="([^"]*?)"/i
  );
  if (descMatch) {
    description = decodeHtmlEntities(descMatch[1]);
  }
  if (!description) {
    const ogMatch = html.match(
      /<meta\s+property="og:description"\s+content="([^"]*?)"/i
    );
    if (ogMatch) description = decodeHtmlEntities(ogMatch[1]);
  }

  const keywordsMatch = html.match(
    /<meta\s+name="keywords"\s+content="([^"]*?)"/i
  );
  if (keywordsMatch) {
    tags = keywordsMatch[1]
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
  }

  try {
    const initialDataMatch = html.match(
      /var\s+ytInitialData\s*=\s*(\{.+?\});\s*<\/script>/s
    );
    if (initialDataMatch) {
      const initialData = JSON.parse(initialDataMatch[1]);
      chapters = extractChaptersFromInitialData(initialData);
    }
  } catch {
    // chapters extraction failed, proceed without
  }

  if (chapters.length === 0) {
    chapters = extractChaptersFromDescription(description);
  }

  return { description, chapters, tags };
}

export async function fetchWatchPageMetadata(
  videoId: string
): Promise<Metadata> {
  const html = await fetchWatchPageHtml(videoId);
  return parseMetadataFromHtml(html);
}

function extractChaptersFromInitialData(data: any): Chapter[] {
  const chapters: Chapter[] = [];
  try {
    const json = JSON.stringify(data);
    const markerMatch = json.match(/"macroMarkersListItemRenderer"/);
    if (!markerMatch) return chapters;

    const findMarkers = (obj: any): void => {
      if (!obj || typeof obj !== 'object') return;
      if (obj.macroMarkersListItemRenderer) {
        const renderer = obj.macroMarkersListItemRenderer;
        const title =
          renderer.title?.simpleText ||
          renderer.title?.runs?.map((r: any) => r.text).join('');
        const timeStr =
          renderer.timeDescription?.simpleText ||
          renderer.timeDescription?.runs?.map((r: any) => r.text).join('');
        if (title && timeStr) {
          chapters.push({ time: parseTimestamp(timeStr), title });
        }
        return;
      }
      if (Array.isArray(obj)) {
        for (const item of obj) findMarkers(item);
      } else {
        for (const val of Object.values(obj)) findMarkers(val);
      }
    };

    findMarkers(data);
  } catch {
    // ignore
  }
  return chapters;
}

function extractChaptersFromDescription(description: string): Chapter[] {
  const chapters: Chapter[] = [];
  const lines = description.split('\n');
  for (const line of lines) {
    const match = line.match(/(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–]?\s*(.+)/);
    if (match) {
      chapters.push({
        time: parseTimestamp(match[1]),
        title: match[2].trim(),
      });
    }
  }
  return chapters;
}

function parseTimestamp(ts: string): number {
  const parts = ts.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&apos;/g, "'");
}

const INVIDIOUS_INSTANCES = [
  'https://yewtu.be',
  'https://invidious.fdn.fr',
  'https://invidious.nerdvpn.de',
  'https://inv.nadeko.net',
];

function getInvidiousUrls(): string[] {
  const envUrls = process.env.YT_INVIDIOUS_URLS;
  if (envUrls) {
    return envUrls.split(',').map(s => s.trim()).filter(Boolean);
  }
  return INVIDIOUS_INSTANCES;
}

async function fetchTranscriptPlayzone(videoId: string): Promise<TranscriptData> {
  const api = new YouTubeTranscriptApi();
  const result: FetchedTranscript = await api.fetch(videoId);
  const text = result.snippets.map(s => s.text).join(' ');
  if (!text) throw new Error('Empty transcript from playzone provider');
  return {
    available: true,
    text,
    language: result.languageCode || 'unknown',
    segmentCount: result.snippets.length,
  };
}

async function fetchTranscriptInvidious(videoId: string): Promise<TranscriptData> {
  const invidiousUrls = getInvidiousUrls();
  const api = new EnhancedYouTubeTranscriptApi(undefined, {
    enabled: true,
    instanceUrls: invidiousUrls,
    timeout: FETCH_TIMEOUT,
  });
  const result = await api.fetch(videoId);
  const snippets = result?.snippets ?? result ?? [];
  const text = (Array.isArray(snippets) ? snippets : []).map((s: any) => s.text).join(' ');
  if (!text) throw new Error('Empty transcript from Invidious provider');
  return {
    available: true,
    text,
    language: result?.languageCode || 'unknown',
    segmentCount: Array.isArray(snippets) ? snippets.length : 0,
  };
}

export async function fetchTranscript(videoUrl: string): Promise<TranscriptData> {
  const videoId = extractVideoId(videoUrl);
  if (!videoId) throw new Error('Invalid YouTube URL');

  // Race both providers in parallel - use whichever succeeds first
  const raceWithTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout')), ms);
      promise.then(v => { clearTimeout(timer); resolve(v); }, e => { clearTimeout(timer); reject(e); });
    });
  };

  try {
    return await raceWithTimeout(
      Promise.any([
        fetchTranscriptPlayzone(videoId),
        fetchTranscriptInvidious(videoId),
      ]),
      15_000 // 15 second timeout for transcript fetch
    );
  } catch (e) {
    throw new Error(
      'Empty transcript \u2013 YouTube may have blocked the request or captions are disabled for this video'
    );
  }
}

export function parseCommentsFromHtml(html: string): Comment[] {
  const comments: Comment[] = [];

  const initialDataMatch = html.match(
    /var\s+ytInitialData\s*=\s*(\{.+?\});\s*<\/script>/s
  );
  if (!initialDataMatch) return comments;

  const data = JSON.parse(initialDataMatch[1]);
  const findComments = (obj: any): void => {
    if (!obj || typeof obj !== 'object' || comments.length >= 10) return;
    if (obj.commentRenderer) {
      const renderer = obj.commentRenderer;
      const text =
        renderer.contentText?.runs?.map((r: any) => r.text).join('');
      const likes = parseInt(renderer.voteCount?.simpleText, 10);
      if (text) comments.push({ text, likes: isNaN(likes) ? 0 : likes });
      return;
    }
    if (Array.isArray(obj)) {
      for (const item of obj) findComments(item);
    } else {
      for (const val of Object.values(obj)) findComments(val);
    }
  };

  findComments(data);
  return comments;
}

export async function fetchTopComments(videoId: string): Promise<Comment[]> {
  try {
    const html = await fetchWatchPageHtml(videoId);
    return parseCommentsFromHtml(html);
  } catch {
    return [];
  }
}

const MAX_TRANSCRIPT_CHARS = 20_000;

export async function gatherSignals(videoUrl: string): Promise<VideoSignals> {
  const videoId = extractVideoId(videoUrl);
  if (!videoId) throw new Error('Invalid YouTube URL');

  const missing: Record<string, string> = {};

  const [oembedResult, watchHtmlResult, transcriptResult] =
    await Promise.allSettled([
      fetchOEmbed(videoUrl),
      fetchWatchPageHtml(videoId),
      fetchTranscript(videoUrl),
    ]);

  const oembed = oembedResult.status === 'fulfilled' ? oembedResult.value : null;
  if (!oembed) missing.oembed = reasonFrom(oembedResult);

  let metadata: Metadata | null = null;
  let comments: Comment[] = [];

  if (watchHtmlResult.status === 'fulfilled') {
    const html = watchHtmlResult.value;
    try { metadata = parseMetadataFromHtml(html); } catch { missing.metadata = 'parse error'; }
    try { comments = parseCommentsFromHtml(html); } catch { /* best-effort */ }
  } else {
    missing.metadata = reasonFrom(watchHtmlResult);
    missing.comments = reasonFrom(watchHtmlResult);
  }

  let transcript = transcriptResult.status === 'fulfilled' ? transcriptResult.value : null;
  if (!transcript) missing.transcript = reasonFrom(transcriptResult);

  if (transcript && transcript.text.length > MAX_TRANSCRIPT_CHARS) {
    transcript = {
      ...transcript,
      text:
        transcript.text.slice(0, MAX_TRANSCRIPT_CHARS / 2) +
        '\n\n[... middle truncated for brevity ...]\n\n' +
        transcript.text.slice(-MAX_TRANSCRIPT_CHARS / 2),
    };
  }

  if (comments.length === 0 && !missing.comments) missing.comments = 'no comments found';

  if (!oembed && !metadata && !transcript) {
    throw new Error(
      'Could not retrieve any information about this video. ' +
        Object.entries(missing)
          .map(([k, v]) => `${k}: ${v}`)
          .join('; ')
    );
  }

  return { videoId, videoUrl, oembed, metadata, transcript, comments, missing };
}

function reasonFrom(result: PromiseSettledResult<any>): string {
  if (result.status === 'rejected') {
    const err = result.reason;
    return err instanceof Error ? err.message : String(err);
  }
  return 'unknown';
}

export function buildFusionPrompt(signals: VideoSignals): string {
  const parts: string[] = [];
  const hasTranscript = !!signals.transcript;
  const hasComments = signals.comments.length > 0;
  const hasMetadata = !!signals.metadata;
  const hasOEmbed = !!signals.oembed;

  if (!hasTranscript) {
    parts.push(
      `You are summarizing a YouTube video using metadata signals. The transcript was not available, but you MUST still produce a complete, confident, and useful summary.

Use every piece of metadata provided — title, description, tags, chapters, and comments — to construct a thorough summary. Write as if you are explaining the video to someone who hasn't watched it.

Output a well-structured markdown summary:
1. A concise overview paragraph of what the video covers
2. Key topics and themes as bullet points (infer from all available metadata)
3. A section outline (use chapters if available, otherwise infer structure from the description)
4. Notable details mentioned in the description or comments

NEVER say the transcript is unavailable, NEVER apologize for limited information, and NEVER suggest the summary might be incomplete. Just write the best summary you can.

Here are the available signals:\n`
    );
  } else {
    parts.push(
      `You are summarizing a YouTube video using multiple extracted signals (no video model was used).
Prefer the transcript as the primary source of content. Use metadata and chapters to structure the summary.
If comments are present, include a brief audience sentiment section.
Output a well-structured markdown summary with:
1. A concise overview paragraph
2. Key takeaways as bullet points
3. A section-by-section outline (use chapters if available, otherwise infer sections from the transcript)
4. Notable quotes or insights (if any)
5. Audience sentiment (only if comments are available)

Here are the signals:\n`
    );
  }

  if (signals.oembed) {
    parts.push(`## Video Info (oEmbed)`);
    parts.push(`- **Title:** ${signals.oembed.title}`);
    parts.push(`- **Author:** ${signals.oembed.authorName}`);
    parts.push('');
  }

  if (signals.metadata) {
    parts.push(`## Metadata`);
    if (signals.metadata.description) {
      parts.push(`**Description:** ${signals.metadata.description}`);
    }
    if (signals.metadata.tags.length > 0) {
      parts.push(`**Tags:** ${signals.metadata.tags.join(', ')}`);
    }
    if (signals.metadata.chapters.length > 0) {
      parts.push(`**Chapters:**`);
      for (const ch of signals.metadata.chapters) {
        const m = Math.floor(ch.time / 60);
        const s = ch.time % 60;
        parts.push(`- ${m}:${s.toString().padStart(2, '0')} — ${ch.title}`);
      }
    }
    parts.push('');
  }

  if (signals.transcript) {
    parts.push(`## Transcript (${signals.transcript.language}, ${signals.transcript.segmentCount} segments)`);
    parts.push(signals.transcript.text);
    parts.push('');
  }

  if (signals.comments.length > 0) {
    parts.push(`## Top Comments (${signals.comments.length})`);
    for (const c of signals.comments) {
      parts.push(`- [${c.likes} likes] ${c.text}`);
    }
    parts.push('');
  }

  if (Object.keys(signals.missing).length > 0) {
    parts.push(`## Unavailable Signals`);
    for (const [key, reason] of Object.entries(signals.missing)) {
      parts.push(`- **${key}:** ${reason}`);
    }
    parts.push('');
  }

  return parts.join('\n');
}

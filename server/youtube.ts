import { YoutubeTranscript, TranscriptResponse } from 'youtube-transcript';

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

export async function fetchWatchPageMetadata(
  videoId: string
): Promise<Metadata> {
  const url = `https://www.youtube.com/watch?v=${videoId}&hl=en`;
  const res = await timedFetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`Watch page returned ${res.status}`);
  const html = await res.text();

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

export async function fetchTranscript(
  videoUrl: string
): Promise<TranscriptData> {
  const items: TranscriptResponse[] =
    await YoutubeTranscript.fetchTranscript(videoUrl);
  if (!items || items.length === 0) {
    throw new Error('Empty transcript – YouTube may have blocked the request or captions are disabled for this video');
  }

  const text = items.map((i) => i.text).join(' ');
  const language = items[0]?.lang ?? 'unknown';

  return {
    available: true,
    text,
    language,
    segmentCount: items.length,
  };
}

export async function fetchTopComments(videoId: string): Promise<Comment[]> {
  const comments: Comment[] = [];
  try {
    const url = `https://www.youtube.com/watch?v=${videoId}&hl=en`;
    const res = await timedFetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });
    if (!res.ok) return comments;
    const html = await res.text();

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
  } catch {
    // comments are best-effort
  }
  return comments;
}

const MAX_TRANSCRIPT_CHARS = 60_000;

export async function gatherSignals(videoUrl: string): Promise<VideoSignals> {
  const videoId = extractVideoId(videoUrl);
  if (!videoId) throw new Error('Invalid YouTube URL');

  const missing: Record<string, string> = {};

  const [oembedResult, metadataResult, transcriptResult, commentsResult] =
    await Promise.allSettled([
      fetchOEmbed(videoUrl),
      fetchWatchPageMetadata(videoId),
      fetchTranscript(videoUrl),
      fetchTopComments(videoId),
    ]);

  const oembed =
    oembedResult.status === 'fulfilled' ? oembedResult.value : null;
  if (!oembed) missing.oembed = reasonFrom(oembedResult);

  const metadata =
    metadataResult.status === 'fulfilled' ? metadataResult.value : null;
  if (!metadata) missing.metadata = reasonFrom(metadataResult);

  let transcript =
    transcriptResult.status === 'fulfilled' ? transcriptResult.value : null;
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

  const comments =
    commentsResult.status === 'fulfilled' ? commentsResult.value : [];
  if (comments.length === 0) missing.comments = reasonFrom(commentsResult);

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

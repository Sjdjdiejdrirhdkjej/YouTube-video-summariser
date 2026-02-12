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

function createTimeout(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

export interface TranscriptResult {
  text: string;
  language: string;
  segmentCount: number;
}

async function fetchFromInvidious(
  videoId: string,
  instanceUrl: string
): Promise<TranscriptResult | null> {
  try {
    const apiUrl = `${instanceUrl}/api/v1/videos/${videoId}`;
    const response = await fetch(apiUrl, {
      signal: createTimeout(10000),
    });
    if (!response.ok) return null;

    const data = await response.json();
    const subtitles = data.subtitles || data.captions;

    if (!subtitles || subtitles.length === 0) return null;

    const subtitle = subtitles.find((s: any) =>
      s.languageCode?.toLowerCase().startsWith('en') ||
      s.code?.toLowerCase().startsWith('en')
    ) || subtitles[0];

    if (!subtitle) return null;

    const captionResponse = await fetch(subtitle.url, {
      signal: createTimeout(10000),
    });
    if (!captionResponse.ok) return null;

    const captionData = await captionResponse.text();

    const text = parseWebVTT(captionData);
    if (!text) return null;

    const segmentCount = (captionData.match(/-->.*\n/g) || []).length;

    return {
      text,
      language: subtitle.languageCode || subtitle.code || 'unknown',
      segmentCount,
    };
  } catch {
    return null;
  }
}

function parseWebVTT(vttContent: string): string {
  try {
    const lines = vttContent.split('\n');
    const transcription: string[] = [];

    for (const line of lines) {
      if (
        line.includes('-->') ||
        line.startsWith('WEBVTT') ||
        line.startsWith('NOTE') ||
        line.trim() === '' ||
        /^\d+$/.test(line.trim())
      ) {
        continue;
      }

      const text = line.trim();
      if (text) {
        const cleanText = text
          .replace(/<c\.[^>]+>/g, '')
          .replace(/<\/c>/g, '')
          .replace(/<\d[^>]*>/g, '')
          .replace(/<[^>]+>/g, '')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"');

        if (cleanText) {
          transcription.push(cleanText);
        }
      }
    }

    return transcription.join(' ');
  } catch {
    return '';
  }
}

export async function fetchTranscript(videoId: string): Promise<TranscriptResult> {
  const invidiousUrls = getInvidiousUrls();

  for (const instanceUrl of invidiousUrls) {
    const result = await fetchFromInvidious(videoId, instanceUrl);
    if (result) return result;
  }

  throw new Error(
    'No transcript available – YouTube may have blocked the request or captions are disabled for this video'
  );
}

export async function fetchTranscriptList(videoId: string): Promise<any[]> {
  const invidiousUrls = getInvidiousUrls();

  for (const instanceUrl of invidiousUrls) {
    try {
      const apiUrl = `${instanceUrl}/api/v1/videos/${videoId}`;
      const response = await fetch(apiUrl, {
        signal: createTimeout(10000),
      });
      if (!response.ok) continue;

      const data = await response.json();
      return data.subtitles || data.captions || [];
    } catch {
      continue;
    }
  }

  return [];
}

export class YouTubeTranscriptApi {
  async fetch(videoId: string): Promise<{
    snippets: Array<{ text: string; duration?: number; offset?: number }>;
    languageCode?: string;
  }> {
    const result = await fetchTranscript(videoId);

    // Split text into approximate segments (simple heuristic)
    const words = result.text.split(' ');
    const snippets: Array<{ text: string; duration?: number; offset?: number }> = [];
    const segmentSize = 10; // words per segment

    for (let i = 0; i < words.length; i += segmentSize) {
      const segment = words.slice(i, i + segmentSize).join(' ');
      snippets.push({ text: segment });
    }

    return {
      snippets,
      languageCode: result.language,
    };
  }
}

export class EnhancedYouTubeTranscriptApi {
  private _invidiousOptions: {
    enabled: boolean;
    instanceUrls: string | string[];
    timeout?: number;
  };

  constructor(
    _proxyOptions?: any,
    invidiousOptions?: {
      enabled: boolean;
      instanceUrls: string | string[];
      timeout?: number;
    }
  ) {
    this._invidiousOptions = invidiousOptions || {
      enabled: true,
      instanceUrls: getInvidiousUrls(),
      timeout: 10000,
    };
  }

  async fetch(videoId: string): Promise<{
    snippets: Array<{ text: string; duration?: number; offset?: number }>;
    languageCode?: string;
  }> {
    const result = await fetchTranscript(videoId);

    const words = result.text.split(' ');
    const snippets: Array<{ text: string; duration?: number; offset?: number }> = [];
    const segmentSize = 10;

    for (let i = 0; i < words.length; i += segmentSize) {
      const segment = words.slice(i, i + segmentSize).join(' ');
      snippets.push({ text: segment });
    }

    return {
      snippets,
      languageCode: result.language,
    };
  }
}

export type FetchedTranscript = {
  snippets: Array<{ text: string; duration?: number; offset?: number }>;
  languageCode?: string;
};

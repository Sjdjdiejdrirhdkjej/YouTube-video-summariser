import './App.css'
import React from 'react'
import { marked } from 'marked'
import { useTheme } from './theme'
import Changelog from './components/Changelog'
import SharedSummary from './components/SharedSummary'
import ChatPage from './components/ChatPage'

marked.setOptions({ breaks: true });

function getFingerprint(): string {
  const key = 'device_fingerprint';
  let fp = localStorage.getItem(key);
  if (!fp) {
    fp = crypto.randomUUID();
    localStorage.setItem(key, fp);
  }
  return fp;
}

export default function App() {
  const { theme, toggleTheme } = useTheme();
  const fingerprint = React.useMemo(() => getFingerprint(), []);
  const [videoUrl, setVideoUrl] = React.useState('');
  const [summary, setSummary] = React.useState('');
  const [displayedSummary, setDisplayedSummary] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [streaming, setStreaming] = React.useState(false);
  const [error, setError] = React.useState('');
  const [retryAfter, setRetryAfter] = React.useState(0);
  const [summaryId, setSummaryId] = React.useState<string | null>(null);
  const [targetSummaryId, setTargetSummaryId] = React.useState<string | null>(null);
  const summaryRef = React.useRef('');
  const animFrameRef = React.useRef(0);
  const displayIndexRef = React.useRef(0);
  const abortControllerRef = React.useRef<AbortController | null>(null);

  const [credits, setCredits] = React.useState<number | null>(null);

  const [page, setPage] = React.useState(window.location.pathname);

  React.useEffect(() => {
    fetch('/api/credits', { headers: { 'X-Fingerprint': fingerprint } })
      .then((r) => r.json())
      .then((data) => setCredits(data.credits))
      .catch(() => {});
  }, [fingerprint]);

  React.useEffect(() => {
    const handler = (e: Event) => setCredits((e as CustomEvent).detail);
    window.addEventListener('credits-update', handler);
    return () => window.removeEventListener('credits-update', handler);
  }, []);

  React.useEffect(() => {
    const onPopState = () => setPage(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  React.useEffect(() => {
    if (targetSummaryId) {
      navigate(`/${targetSummaryId}`);
      setTargetSummaryId(null);
    }
  }, [targetSummaryId]);

  React.useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  React.useEffect(() => {
    if (retryAfter <= 0) return;
    const timer = setInterval(() => {
      setRetryAfter((prev) => {
        if (prev <= 1) {
          setError('');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [retryAfter > 0]);

  const navigate = (path: string) => {
    window.history.pushState({}, '', path);
    setPage(path);
  };

  const extractVideoId = (url: string): string | null => {
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : null;
  };

  React.useEffect(() => {
    if (!streaming && summary && displayIndexRef.current < summary.length) {
      const tick = () => {
        const target = summaryRef.current;
        const idx = displayIndexRef.current;
        if (idx < target.length) {
          const step = Math.min(3, target.length - idx);
          displayIndexRef.current = idx + step;
          setDisplayedSummary(target.slice(0, idx + step));
          animFrameRef.current = requestAnimationFrame(tick);
        }
      };
      animFrameRef.current = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(animFrameRef.current);
    }
  }, [streaming, summary]);

  const handleSummarize = async () => {
    if (!videoUrl.trim()) {
      setError('Please enter a YouTube video URL');
      return;
    }

    const videoId = extractVideoId(videoUrl);
    if (!videoId) {
      setError('Invalid YouTube video URL');
      setSummary('');
      setDisplayedSummary('');
      return;
    }

    setLoading(true);
    setStreaming(false);
    setError('');
    setSummary('');
    setDisplayedSummary('');
    setSummaryId(null);
    setTargetSummaryId(null);
    summaryRef.current = '';
    displayIndexRef.current = 0;
    cancelAnimationFrame(animFrameRef.current);

    try {
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      const res = await fetch('/api/summarize-hybrid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Fingerprint': fingerprint },
        body: JSON.stringify({ videoUrl: videoUrl.trim() }),
        signal: abortController.signal,
      });

      if (!res.ok) {
        try {
          const data = await res.json();
          if (data.credits !== undefined) setCredits(data.credits);
          if (data.retryAfter) setRetryAfter(data.retryAfter);
          setError(data.error);
        } catch {
          setError(`Request failed (${res.status})`);
        }
        setLoading(false);
        return;
      }

      setLoading(false);
      setStreaming(true);

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        setError('Streaming not supported');
        setStreaming(false);
        return;
      }

      let buffer = '';
      let stopped = false;

      const tickAnimation = () => {
        const target = summaryRef.current;
        const idx = displayIndexRef.current;
        if (idx < target.length) {
          const step = Math.min(3, target.length - idx);
          displayIndexRef.current = idx + step;
          setDisplayedSummary(target.slice(0, idx + step));
        }
        if (!stopped) {
          animFrameRef.current = requestAnimationFrame(tickAnimation);
        }
      };
      animFrameRef.current = requestAnimationFrame(tickAnimation);

      while (!stopped) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        buffer = buffer.replace(/\r\n/g, '\n');

        const events = buffer.split('\n\n');
        buffer = events.pop() || '';

        for (const evt of events) {
          const dataLines = evt
            .split('\n')
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).replace(/^ /, ''));

          if (!dataLines.length) continue;

          const data = dataLines.join('\n');
          if (data === '[DONE]') {
            stopped = true;
            break;
          }

          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              if (parsed.retryAfter) setRetryAfter(parsed.retryAfter);
              setError(parsed.error);
              stopped = true;
              break;
            }
            if (parsed.credits !== undefined) setCredits(parsed.credits);
            if (parsed.summaryId) {
              setSummaryId(parsed.summaryId);
              setTargetSummaryId(parsed.summaryId);
            }
            if (parsed.text) {
              summaryRef.current += parsed.text;
              setSummary(summaryRef.current);
            }
          } catch {
            // ignore parse errors
          }
        }
      }

      try { await reader.cancel(); } catch {}
      cancelAnimationFrame(animFrameRef.current);
      setDisplayedSummary(summaryRef.current);
      displayIndexRef.current = summaryRef.current.length;
      setStreaming(false);
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        setLoading(false);
        setStreaming(false);
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
      setStreaming(false);
    }
  };

  const renderedHtml = React.useMemo(() => {
    if (!displayedSummary) return '';
    return marked.parse(displayedSummary) as string;
  }, [displayedSummary]);

  if (page === '/changelog') {
    return <Changelog onBack={() => navigate('/')} />;
  }

  const summaryChatMatch = page.match(/^\/([a-f0-9]{8})\/chat$/);
  if (summaryChatMatch) {
    return <ChatPage summaryId={summaryChatMatch[1]} onBack={() => navigate(`/${summaryChatMatch[1]}`)} />;
  }

  const chatPageMatch = page.match(/^\/chat\/([a-f0-9]{8})$/);
  if (chatPageMatch) {
    return <ChatPage id={chatPageMatch[1]} onBack={() => navigate('/')} />;
  }

  const sharedMatch = page.match(/^\/([a-f0-9]{8})$/);
  if (sharedMatch) {
    return (
      <SharedSummary
        id={sharedMatch[1]}
        onBack={() => navigate('/')}
        onChat={() => navigate(`/${sharedMatch[1]}/chat`)}
      />
    );
  }

  return (
    <div className="app-container">
      <button
        type="button"
        className="theme-toggle-btn"
        onClick={() => toggleTheme()}
        aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        {theme === 'dark' ? '☀' : '☾'}
      </button>
      <header className="app-header">
        <h1>Video Summarizer</h1>
        <p>Paste a YouTube link to get a summary</p>
        {credits !== null && (
          <div className="credits-display">
            <span className="credits-badge">{credits} credits remaining</span>
            <span className="credits-value">(${(credits * 0.01).toFixed(2)} value)</span>
          </div>
        )}
      </header>
      <main className="main-content">
        <div className="video-input">
          <input
            value={videoUrl}
            onChange={(e) => setVideoUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSummarize()}
            type="text"
            placeholder="https://youtube.com/watch?v=..."
            className="url-input"
            disabled={loading || streaming || retryAfter > 0}
          />
          <button
            type="button"
            className="summarize-btn"
            onClick={handleSummarize}
            disabled={loading || streaming || retryAfter > 0}
          >
            {loading ? 'Processing video…' : streaming ? 'Streaming…' : retryAfter > 0 ? `Wait ${retryAfter}s` : 'Summarize'}
          </button>
        </div>
        
        <div className="sample-urls">
          <p className="sample-urls-label">Try a sample:</p>
          {[
            { label: 'How AI Works', url: 'https://www.youtube.com/watch?v=aircAruvnKk' },
            { label: 'History of the Internet', url: 'https://www.youtube.com/watch?v=9hIQjrMHTv4' },
            { label: 'How Computers Work', url: 'https://www.youtube.com/watch?v=QZwneRb-zqA' },
          ].map((sample) => (
            <button
              key={sample.url}
              type="button"
              className="sample-url-btn"
              onClick={() => setVideoUrl(sample.url)}
              disabled={loading || streaming}
            >
              {sample.label}
            </button>
          ))}
        </div>
        <div className="summary-output">
          <h2>Summary</h2>
          {loading && (
            <div className="summary-text loading-indicator">
              <span className="dot-pulse" />
              Processing video…
            </div>
          )}
          {error && (
            <p className="summary-text error">
              {error}
              {retryAfter > 0 && (
                <span className="retry-countdown"> Retry available in {retryAfter}s</span>
              )}
            </p>
          )}
          {displayedSummary && (
            <div
              className={`summary-text markdown-body${streaming ? ' streaming' : ''}`}
              dangerouslySetInnerHTML={{ __html: renderedHtml }}
            />
          )}
          {summary && !streaming && !loading && (
            <>
              {summaryId && (
                <p className="summary-id">
                  Summary ID: <code>/{summaryId}</code>
                </p>
              )}
              <div className="summary-actions">
                {summaryId && (
                  <button
                    type="button"
                    className="chat-toggle-btn"
                    onClick={() => navigate(`/${summaryId}/chat`)}
                  >
                    Chat about this
                  </button>
                )}
                {summaryId && (
                  <button
                    type="button"
                    className="share-link-btn"
                    onClick={() => {
                      const url = `${window.location.origin}/${summaryId}`;
                      navigator.clipboard.writeText(url);
                    }}
                  >
                    Copy share link (/{summaryId})
                  </button>
                )}
              </div>
            </>
          )}
          {!loading && !streaming && !error && !displayedSummary && (
            <p className="summary-text empty">Enter a YouTube URL above to see a summary.</p>
          )}
        </div>
      </main>
      <footer className="app-footer">
        <button type="button" className="footer-link" onClick={() => navigate('/changelog')}>
          Changelog
        </button>
      </footer>
    </div>
  );
}

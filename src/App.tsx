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
  const analysisMode = 'hybrid';
  const [summaryId, setSummaryId] = React.useState<string | null>(null);
  const [targetSummaryId, setTargetSummaryId] = React.useState<string | null>(null);
  const [thinkingText, setThinkingText] = React.useState('');
  const [isThinking, setIsThinking] = React.useState(false);
  const thinkingRef = React.useRef('');
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
    setThinkingText('');
    setIsThinking(false);
    thinkingRef.current = '';
    summaryRef.current = '';
    displayIndexRef.current = 0;
    cancelAnimationFrame(animFrameRef.current);

    try {
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      const res = await fetch('/api/summarize-hybrid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Fingerprint': fingerprint },
        body: JSON.stringify({ videoUrl: videoUrl.trim(), analysisMode }),
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
            if (parsed.thinking) {
              thinkingRef.current += parsed.thinking;
              setThinkingText(thinkingRef.current);
              setIsThinking(true);
            }
            if (parsed.text) {
              if (thinkingRef.current) {
                setIsThinking(false);
              }
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
    <div className="app">
      <nav className="nav">
        <button
          type="button"
          className="nav-brand"
          onClick={() => { setVideoUrl(''); setSummary(''); setDisplayedSummary(''); setError(''); setSummaryId(null); }}
        >
          Summa
        </button>
        <div className="nav-right">
          {credits !== null && (
            <span className="nav-credits">{credits} credits</span>
          )}
          <button
            type="button"
            className="theme-btn"
            onClick={() => toggleTheme()}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
            )}
          </button>
        </div>
      </nav>

      <div className="hero">
        <h1 className="hero-title">Summarize any YouTube video</h1>
        <p className="hero-sub">Paste a link and get an AI-powered summary in seconds.</p>
      </div>

      <div className="input-row">
        <input
          value={videoUrl}
          onChange={(e) => setVideoUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSummarize()}
          type="text"
          placeholder="Paste a YouTube URL..."
          className="url-input"
          disabled={loading || streaming || retryAfter > 0}
        />
        <button
          type="button"
          className="go-btn"
          onClick={handleSummarize}
          disabled={loading || streaming || retryAfter > 0}
        >
          {loading ? (
            <span className="spinner" />
          ) : streaming ? (
            <span className="spinner" />
          ) : retryAfter > 0 ? (
            `${retryAfter}s`
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
          )}
        </button>
      </div>

      <div className="samples">
        <span className="samples-label">Try:</span>
        {[
          { label: 'How AI Works', url: 'https://www.youtube.com/watch?v=aircAruvnKk' },
          { label: 'History of the Internet', url: 'https://www.youtube.com/watch?v=9hIQjrMHTv4' },
          { label: 'How Computers Work', url: 'https://www.youtube.com/watch?v=QZwneRb-zqA' },
        ].map((s) => (
          <button
            key={s.url}
            type="button"
            className="sample-link"
            onClick={() => setVideoUrl(s.url)}
            disabled={loading || streaming}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="output">
        {error && (
          <div className="error-banner">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
            <span>{error}</span>
            {retryAfter > 0 && <span className="retry-tag">Retry in {retryAfter}s</span>}
          </div>
        )}

        {loading && (
          <div className="skeleton">
            <div className="skeleton-line w-full" />
            <div className="skeleton-line w-3/4" />
            <div className="skeleton-line w-5/6" />
            <div className="skeleton-line w-2/3" />
          </div>
        )}

        {(isThinking || thinkingText) && (
          <div className="thinking-panel">
            <div className="thinking-header">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
              <span>{isThinking ? 'Thinking...' : 'Thought process'}</span>
              {isThinking && <span className="thinking-spinner" />}
            </div>
            <pre className="thinking-content">{thinkingText}</pre>
          </div>
        )}

        {displayedSummary && (
          <div className="result-card">
            <div
              className={`prose${streaming ? ' streaming' : ''}`}
              dangerouslySetInnerHTML={{ __html: renderedHtml }}
            />
          </div>
        )}

        {summary && !streaming && !loading && summaryId && (
          <div className="actions">
            <button type="button" className="action-btn primary" onClick={() => navigate(`/${summaryId}/chat`)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              Chat about this
            </button>
            <button
              type="button"
              className="action-btn"
              onClick={() => {
                const url = `${window.location.origin}/${summaryId}`;
                navigator.clipboard.writeText(url);
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
              Copy link
            </button>
          </div>
        )}

        {!loading && !streaming && !error && !displayedSummary && (
          <div className="empty-state">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" opacity="0.2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
            <p>Your summary will appear here</p>
          </div>
        )}
      </div>

      <footer className="footer">
        <button type="button" className="footer-link" onClick={() => navigate('/changelog')}>
          Changelog
        </button>
      </footer>
    </div>
  );
}

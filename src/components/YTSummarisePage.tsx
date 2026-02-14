import React from 'react';
import { marked } from 'marked';
import { useError } from '../context/ErrorContext';
import { puterClient } from '../lib/puterClient';
import './manus-theme.css';

interface YTSummarisePageProps {
  onBack: () => void;
}

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

export default function YTSummarisePage({ onBack }: YTSummarisePageProps) {
  const { addError } = useError();
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
  const [thinkingText, setThinkingText] = React.useState('');
  const [isThinking, setIsThinking] = React.useState(false);
  const [progressSteps, setProgressSteps] = React.useState<Array<{ step: string; message: string; done: boolean; timestamp?: number }>>([]);
  const [showInitialSkeleton, setShowInitialSkeleton] = React.useState(false);
  const [elapsedSeconds, setElapsedSeconds] = React.useState(0);
  const [progressPercent, setProgressPercent] = React.useState(0);

  // Timer to update elapsed time
  React.useEffect(() => {
    if (!loading) {
      setElapsedSeconds(0);
      return;
    }
    const interval = setInterval(() => {
      setElapsedSeconds(prev => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [loading]);

  // Calculate progress percentage based on completed steps
  React.useEffect(() => {
    if (!loading) {
      setProgressPercent(0);
      return;
    }
    if (progressSteps.length === 0) {
      setProgressPercent(5); // Initial step
      return;
    }
    const doneCount = progressSteps.filter(s => s.done).length;
    const total = progressSteps.length;
    const base = Math.round((doneCount / total) * 80);
    
    // Add time-based bonus for current step
    const currentStep = progressSteps.find(s => !s.done);
    if (currentStep && currentStep.timestamp) {
      const stepElapsed = (Date.now() - currentStep.timestamp) / 1000;
      const timeBonus = Math.min(stepElapsed / 3, 15);
      setProgressPercent(Math.min(Math.round(base + timeBonus), 95));
    } else {
      setProgressPercent(base);
    }
  }, [loading, progressSteps]);
  const thinkingRef = React.useRef('');
  const summaryRef = React.useRef('');
  const abortControllerRef = React.useRef<AbortController | null>(null);
  const skeletonTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const [sources, setSources] = React.useState<string[]>([]);
  const [puterSignedIn, setPuterSignedIn] = React.useState(false);

  React.useEffect(() => {
    setPuterSignedIn(puterClient.isSignedIn());
    puterClient.whenReady().then((signedIn) => setPuterSignedIn(signedIn));
  }, []);

  React.useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      if (skeletonTimeoutRef.current) {
        clearTimeout(skeletonTimeoutRef.current);
      }
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

  const extractVideoId = (url: string): string | null => {
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : null;
  };

  const handleSignIn = async () => {
    try {
      await puterClient.signIn();
      setPuterSignedIn(true);
    } catch (err) {
      addError(err);
      setError('Failed to sign in with Puter');
    }
  };

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

    // Check Puter auth for real mode
    if (!puterClient.isSignedIn() && import.meta.env.VITE_PUTER_MOCK !== '1') {
      setError('Please sign in with Puter to use summarization');
      return;
    }

    setLoading(true);
    setStreaming(true);
    setError('');
    setSummary('');
    setDisplayedSummary('');
    setSummaryId(null);
    setThinkingText('');
    setIsThinking(false);
    setSources([]);
    setProgressPercent(0);
    thinkingRef.current = '';
    summaryRef.current = '';

    skeletonTimeoutRef.current = setTimeout(() => {
      setShowInitialSkeleton(true);
    }, 300);

    try {
      const abortController = new AbortController();
      abortControllerRef.current = abortController;
      setProgressSteps([]);
      setShowInitialSkeleton(false);

      // First, get prompt from backend
      setProgressSteps([{ step: 'gathering', message: 'Gathering video signals...', done: false }]);
      
      let r = await fetch('/api/summarize-hybrid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl: videoUrl.trim() }),
        signal: abortController.signal,
      });

      if (!r.ok) {
        let d: Record<string, unknown> = {};
        try {
          d = await r.json();
        } catch (e) {
          addError(e);
        }
        if (d.retryAfter) setRetryAfter(d.retryAfter as number);
        setError(typeof d.error === 'string' ? d.error : `Request failed (${r.status})`);
        setLoading(false);
        abortControllerRef.current = null;
        return;
      }

      // Parse SSE response for prompt
      const reader = r.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error('No response body');

      let buffer = '';
      let prompt = '';
      let sources: string[] = [];

      while (true) {
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
            break;
          }

          try {
            const parsed = JSON.parse(data);
            
            if (parsed.progress) {
              const { step, message } = parsed.progress;
              setProgressSteps(prev => [...prev, { step, message, done: false }]);
            }
            
            if (parsed.prompt) {
              prompt = parsed.prompt;
              if (Array.isArray(parsed.sources)) {
                sources = parsed.sources;
                setSources(parsed.sources);
              }
              setProgressSteps(prev => [...prev.filter(p => p.step !== 'gathering'), { step: 'gathering', message: 'Video signals gathered', done: true }]);
            }
          } catch (e) {
            console.error('SSE parse error:', e);
          }
        }
      }

      if (!prompt) {
        setError('Failed to generate prompt from video');
        setLoading(false);
        return;
      }

      // Now use Puter to generate summary
      setProgressSteps(prev => [...prev, { step: 'processing', message: 'Generating summary with AI...', done: false }]);
      
      let fullSummary = '';
      const stream = puterClient.summarizeStream(prompt, { stream: true });
      const iterator = stream[Symbol.asyncIterator]();
      const AI_STALL_MS = 45_000;
      const AI_OVERALL_MS = 120_000;
      const aiStart = Date.now();
      let stallTimer: ReturnType<typeof setTimeout> | undefined;

      try {
        while (!abortController.signal.aborted) {
          if (Date.now() - aiStart > AI_OVERALL_MS) {
            throw new Error('AI summary generation timed out after 2 minutes. Please try again.');
          }

          const { done, value: event } = await Promise.race([
            iterator.next(),
            new Promise<never>((_, reject) => {
              stallTimer = setTimeout(
                () => reject(new Error('AI response stalled — no data received for 45 seconds. Please try again.')),
                AI_STALL_MS
              );
            }),
          ]);
          clearTimeout(stallTimer);

          if (done) break;

          if (event.thinking) {
            thinkingRef.current += event.thinking;
            setThinkingText(thinkingRef.current);
            setIsThinking(true);
          }

          if (event.text) {
            fullSummary += event.text;
            setDisplayedSummary(fullSummary);
            setProgressSteps(prev => {
              const hasProcessing = prev.some(p => p.step === 'processing');
              if (hasProcessing) {
                return prev.map(p => p.step === 'processing' ? { ...p, done: true } : p);
              }
              return prev;
            });
          }
        }
      } finally {
        clearTimeout(stallTimer);
        iterator.return?.(undefined);
      }

      if (abortController.signal.aborted) {
        setLoading(false);
        return;
      }

      // Persist summary to backend
      setProgressSteps(prev => [...prev, { step: 'saving', message: 'Saving summary...', done: false }]);
      
      const persistRes = await fetch('/api/summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl, summary: fullSummary, sources }),
      });

      if (!persistRes.ok) {
        setError('Failed to save summary');
        setLoading(false);
        return;
      }

      const { summaryId: persistedSummaryId } = await persistRes.json();
      setSummaryId(persistedSummaryId);
      
      setProgressSteps(prev => [...prev.map(p => p.step === 'saving' ? { ...p, done: true } : p)]);
      setProgressPercent(100);
      setSummary(fullSummary);
      setLoading(false);
      setStreaming(false);
      abortControllerRef.current = null;
    } catch (err) {
      addError(err);
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
      setStreaming(false);
      abortControllerRef.current = null;
    }
  };

  const renderedHtml = React.useMemo(() => {
    if (!displayedSummary) return '';
    return marked.parse(displayedSummary) as string;
  }, [displayedSummary]);

  const copyLink = () => {
    if (summaryId) {
      const url = `${window.location.origin}/${summaryId}`;
      navigator.clipboard.writeText(url);
    }
  };

  const hasResults = !!summary || loading || streaming;

  const inputBar = (
    <div className="manus-input-wrap">
      <div className="manus-input-bar">
        <input
          value={videoUrl}
          onChange={(e) => setVideoUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSummarize()}
          type="text"
          placeholder="Paste a YouTube URL..."
          className="manus-input"
          disabled={loading || streaming || retryAfter > 0}
        />
        <button
          type="button"
          className="manus-send-btn"
          onClick={handleSummarize}
          disabled={loading || streaming || retryAfter > 0}
        >
          {loading ? (
            <span className="manus-send-spinner" />
          ) : retryAfter > 0 ? (
            <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>{retryAfter}s</span>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );

  return (
    <div className="manus-root">
      <div className="manus-bg-orbs">
        <div className="manus-orb manus-orb--1" />
        <div className="manus-orb manus-orb--2" />
        <div className="manus-orb manus-orb--3" />
      </div>

      <nav className="manus-nav">
        <button type="button" className="manus-nav-back" onClick={onBack}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          Back
        </button>
        <span className="manus-nav-brand">VidGist</span>
        <div className="manus-nav-auth">
          {puterSignedIn ? (
            <span className="manus-auth-status">Signed in</span>
          ) : import.meta.env.VITE_PUTER_MOCK === '1' ? (
            <span className="manus-auth-status manus-auth-status--mock">Mock Mode</span>
          ) : (
            <button
              type="button"
              className="manus-auth-button"
              onClick={handleSignIn}
              disabled={loading || streaming}
            >
              Sign in with Puter
            </button>
          )}
        </div>
      </nav>

      <div className="manus-content">
        {!hasResults && (
          <div className="manus-hero">
            <div className="manus-hero-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="23 7 16 12 23 17 23 7" />
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
              </svg>
            </div>
            <h1 className="manus-hero-title">What would you like to summarize?</h1>
            <p className="manus-hero-sub">Paste a YouTube URL and get an AI-powered summary in seconds</p>

            <div className="manus-pills">
              {[
                { label: 'How AI Works', url: 'https://www.youtube.com/watch?v=aircAruvnKk', icon: (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2a4 4 0 0 1 4 4v1h1a3 3 0 0 1 0 6h-1v1a4 4 0 0 1-8 0v-1H7a3 3 0 0 1 0-6h1V6a4 4 0 0 1 4-4z" />
                  </svg>
                )},
                { label: 'History of Internet', url: 'https://www.youtube.com/watch?v=9hIQjrMHTv4', icon: (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="2" y1="12" x2="22" y2="12" />
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                  </svg>
                )},
                { label: 'How Computers Work', url: 'https://www.youtube.com/watch?v=QZwneRb-zqA', icon: (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                    <line x1="8" y1="21" x2="16" y2="21" />
                    <line x1="12" y1="17" x2="12" y2="21" />
                  </svg>
                )},
              ].map((s) => (
                <button
                  key={s.url}
                  type="button"
                  className="manus-pill"
                  onClick={() => setVideoUrl(s.url)}
                  disabled={loading || streaming}
                >
                  {s.icon}
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {!hasResults && (
          <div className="manus-input-bottom">
            {inputBar}
          </div>
        )}

        {error && (
          <div className="manus-error">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
            <span>{error}</span>
            {retryAfter > 0 && <span className="manus-retry-tag">Retry in {retryAfter}s</span>}
          </div>
        )}

        {(loading && progressSteps.length === 0) || showInitialSkeleton ? (
          <div className="manus-initial-loading">
            <div className="manus-initial-loading-inner">
              <div className="manus-initial-loading-icon">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="23 7 16 12 23 17 23 7" />
                  <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                </svg>
              </div>
              <div className="manus-initial-dots">
                <span /><span /><span />
              </div>
              <p className="manus-initial-text">Analyzing video...</p>
            </div>
          </div>
        ) : null}

        {progressSteps.length > 0 && (
          <div className="manus-live-progress">
            <div className="manus-live-progress-header">
              <span className="manus-live-spinner" />
              <span className="manus-live-title">
                {progressSteps.some(p => p.step === 'processing' && !p.done) 
                  ? 'AI is thinking...' 
                  : 'Analyzing video...'}
              </span>
              <span className="manus-live-time">
                {elapsedSeconds < 5 ? '' : elapsedSeconds < 60 ? `${elapsedSeconds}s` : `${Math.floor(elapsedSeconds / 60)}m ${elapsedSeconds % 60}s`}
              </span>
              <button
                type="button"
                className="manus-cancel-btn"
                onClick={() => {
                  abortControllerRef.current?.abort();
                  setLoading(false);
                  setError('');
                  setProgressSteps([]);
                  setShowInitialSkeleton(false);
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="manus-live-track">
              <div className="manus-live-bar" style={{ width: `${progressPercent}%` }} />
            </div>
            <div className="manus-live-stream">
              {progressSteps.filter(p => p.step !== 'thinking').slice(-5).map((step, idx, arr) => {
                const isLatest = idx === arr.length - 1 && !step.done;
                return (
                  <div 
                    key={step.step + step.timestamp} 
                    className={`manus-live-step ${step.done ? 'done' : ''} ${isLatest ? 'active' : ''}`}
                  >
                    <span className="manus-live-dot">
                      {step.done ? (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : isLatest ? (
                        <span className="manus-live-pulse" />
                      ) : (
                        <span className="manus-live-dot-inner" />
                      )}
                    </span>
                    <span className="manus-live-msg">{step.message}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {(isThinking || thinkingText) && (
          <div className="manus-thinking">
            <div className="manus-thinking-header">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4" />
                <path d="M12 8h.01" />
              </svg>
              <span>{isThinking ? 'Thinking...' : 'Thought process'}</span>
              {isThinking && <span className="manus-thinking-spinner" />}
            </div>
            <pre className="manus-thinking-content">{thinkingText}</pre>
          </div>
        )}

        {displayedSummary && (
          <div className="manus-result">
            {sources.includes('cache') && (
              <div className="manus-source-badge manus-source-badge--cache">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                  <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                  <line x1="12" y1="22.08" x2="12" y2="12" />
                </svg>
                Cached summary
              </div>
            )}
            {!sources.includes('cache') && sources.length > 0 && (
              <div className="manus-source-badge manus-source-badge--fresh">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
                Freshly generated
              </div>
            )}
            <div
              className={`prose${streaming ? ' streaming' : ''}`}
              dangerouslySetInnerHTML={{ __html: renderedHtml }}
            />
          </div>
        )}

        {summary && !streaming && !loading && summaryId && (
          <div className="manus-actions">
            <button type="button" className="manus-action-btn manus-action-btn--primary" onClick={() => window.location.href = `/${summaryId}/chat`}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              Chat about this
            </button>
            <button type="button" className="manus-action-btn" onClick={copyLink}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
              Copy link
            </button>
          </div>
        )}

        {hasResults && !loading && !streaming && summary && (
          <div className="manus-inline-input">
            {inputBar}
          </div>
        )}
      </div>
    </div>
  );
}

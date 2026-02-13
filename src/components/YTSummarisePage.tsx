import React from 'react';
import { marked } from 'marked';

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
  const [progressSteps, setProgressSteps] = React.useState<Array<{ step: string; message: string; done: boolean }>>([]);
  const [showInitialSkeleton, setShowInitialSkeleton] = React.useState(false);
  const thinkingRef = React.useRef('');
  const summaryRef = React.useRef('');
  const abortControllerRef = React.useRef<AbortController | null>(null);
  const skeletonTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const [credits, setCredits] = React.useState<number | null>(null);

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
    setThinkingText('');
    setIsThinking(false);
    thinkingRef.current = '';
    summaryRef.current = '';

    // Show initial skeleton after a short delay to avoid flicker for fast responses
    skeletonTimeoutRef.current = setTimeout(() => {
      setShowInitialSkeleton(true);
    }, 300);

    try {
      const abortController = new AbortController();
      abortControllerRef.current = abortController;
      setProgressSteps([]);
      setShowInitialSkeleton(false);

      const parseSSEResponse = async (r: Response): Promise<{ fullSummary: string; thinking: string; summaryId: string | null; credits: number | null }> => {
        const reader = r.body?.getReader();
        const decoder = new TextDecoder();
        if (!reader) throw new Error('No response body');

        let buffer = '';
        let stopped = false;
        let fullSummary = '';
        let returnedThinking = '';
        let returnedSummaryId: string | null = null;
        let credits: number | null = null;

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

              if (parsed.progress) {
                const { step, message, thinking } = parsed.progress;
                
                // Handle streaming thinking in real-time
                if (thinking) {
                  thinkingRef.current += thinking;
                  setThinkingText(thinkingRef.current);
                  setIsThinking(true);
                }
                
                // Update progress steps - handle both old 'generating' step and new granular steps
                if (message) {
                  // Map old 'generating' step to new granular steps if needed
                  const stepMap: Record<string, string> = {
                    'generating': 'analyzing',
                    'analyzing': 'analyzing',
                    'reasoning': 'reasoning',
                    'drafting': 'drafting',
                    'refining': 'refining',
                  };
                  const mappedStep = stepMap[step] || step;
                  
                  // Only add new granular steps if they don't exist yet
                  const granularSteps = ['analyzing', 'reasoning', 'drafting', 'refining'];
                  if (granularSteps.includes(mappedStep)) {
                    setProgressSteps(prev => {
                      // Check if we already have more granular steps
                      const hasGranular = prev.some(p => granularSteps.includes(p.step));
                      if (hasGranular && mappedStep !== 'thinking') {
                        // Update existing step
                        const idx = prev.findIndex(p => p.step === mappedStep);
                        if (idx >= 0) {
                          const updated = [...prev];
                          updated[idx] = { ...updated[idx], message, done: step === 'complete' };
                          return updated;
                        }
                      }
                      // Add new step
                      return [...prev, { step: mappedStep, message, done: step === 'complete' }];
                    });
                  } else {
                    // Legacy step handling
                    setProgressSteps(prev => {
                      const idx = prev.findIndex(p => p.step === step);
                      if (idx >= 0) {
                        const updated = [...prev];
                        updated[idx] = { step, message, done: step === 'complete' };
                        return updated;
                      }
                      return [...prev, { step, message, done: step === 'complete' }];
                    });
                  }
                }
              }

              if (parsed.summary) {
                fullSummary = parsed.summary;
                returnedSummaryId = parsed.summaryId;
                returnedThinking = parsed.thinking || '';
                if (typeof parsed.credits === 'number') {
                  credits = parsed.credits;
                  setCredits(parsed.credits);
                }
              }

              if (parsed.error) {
                if (parsed.retryAfter) setRetryAfter(parsed.retryAfter as number);
                throw new Error(parsed.error as string);
              }
            } catch {}
          }
        }

        try { await reader.cancel(); } catch {}
        return { fullSummary, thinking: returnedThinking, summaryId: returnedSummaryId, credits };
      };

      let r = await fetch('/api/summarize-hybrid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Fingerprint': fingerprint },
        body: JSON.stringify({ videoUrl: videoUrl.trim(), analysisMode }),
        signal: abortController.signal,
      });

      if (!r.ok) {
        let d: Record<string, unknown> = {};
        try { d = await r.json(); } catch {}
        if (d.retryAfter) setRetryAfter(d.retryAfter as number);
        setError(typeof d.error === 'string' ? d.error : `Request failed (${r.status})`);
        setLoading(false);
        abortControllerRef.current = null;
        return;
      }

      let result = await parseSSEResponse(r);

      if (!result.fullSummary.trim()) {
        try {
          setProgressSteps([{ step: 'fallback', message: 'Trying alternative method...', done: false }]);
          r = await fetch('/api/summarize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Fingerprint': fingerprint },
            body: JSON.stringify({ videoUrl: videoUrl.trim(), analysisMode }),
            signal: abortController.signal,
          });
          if (r.ok) {
            const data = await r.json();
            if (data.summary?.trim()) {
              result = { fullSummary: data.summary, thinking: '', summaryId: data.summaryId, credits: data.credits };
              if (typeof data.credits === 'number') setCredits(data.credits);
            }
          }
        } catch {}
      }

      const { fullSummary, thinking: returnedThinking, summaryId: returnedSummaryId } = result;

      if (!fullSummary.trim()) {
        setError('Could not generate a summary for this video. The video may be unavailable or restricted.');
        setLoading(false);
        abortControllerRef.current = null;
        return;
      }

      if (returnedSummaryId) {
        setSummaryId(returnedSummaryId);
      }

      if (returnedThinking.trim()) {
        thinkingRef.current = returnedThinking;
        setThinkingText(returnedThinking);
        setIsThinking(false);
      }

      summaryRef.current = fullSummary;
      setSummary(fullSummary);
      setDisplayedSummary(fullSummary);
      setLoading(false);
      setStreaming(false);
      abortControllerRef.current = null;
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        setLoading(false);
        setStreaming(false);
        abortControllerRef.current = null;
        return;
      }
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

  return (
    <div className="ytsummarise">
      <nav className="ytsummarise-nav">
        <button type="button" className="back-btn" onClick={onBack}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"/>
            <polyline points="12 19 5 12 12 5"/>
          </svg>
          Back
        </button>
        <span className="ytsummarise-brand">VidGist</span>
        <div className="ytsummarise-credits">
          {credits !== null && <span>{credits} credits</span>}
        </div>
      </nav>

      <div className="ytsummarise-content">
        {!summary && !loading && (
          <div className="ytsummarise-input-section">
            <h1 className="ytsummarise-title">Summarize a YouTube Video</h1>
            <p className="ytsummarise-subtitle">Paste a YouTube URL to get an AI-powered summary</p>
            
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
                ) : retryAfter > 0 ? (
                  `${retryAfter}s`
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="5" y1="12" x2="19" y2="12"/>
                    <polyline points="12 5 19 12 12 19"/>
                  </svg>
                )}
              </button>
            </div>

            <div className="samples">
              <span className="samples-label">Try:</span>
              {[
                { label: 'How AI Works', url: 'https://www.youtube.com/watch?v=aircAruvnKk' },
                { label: 'History of Internet', url: 'https://www.youtube.com/watch?v=9hIQjrMHTv4' },
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
          </div>
        )}

        {error && (
          <div className="error-banner">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="15" y1="9" x2="9" y2="15"/>
              <line x1="9" y1="9" x2="15" y2="15"/>
            </svg>
            <span>{error}</span>
            {retryAfter > 0 && <span className="retry-tag">Retry in {retryAfter}s</span>}
          </div>
        )}

        {(loading && progressSteps.length === 0) || showInitialSkeleton ? (
          <div className="initial-loading">
            <div className="initial-loading-content">
              <div className="initial-loading-icon">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="23 7 16 12 23 17 23 7"/>
                  <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                </svg>
              </div>
              <div className="initial-loading-dots">
                <span className="dot" /><span className="dot" /><span className="dot" />
              </div>
              <p className="initial-loading-text">Analyzing video...</p>
            </div>
          </div>
        ) : null}

        {progressSteps.length > 0 && (
          <div className="progress-panel">
            <div className="progress-header">
              <div className="progress-spinner" />
              <span>Generating summary...</span>
            </div>
            <div className="progress-steps">
              {progressSteps.map((step) => (
                <div key={step.step}>
                  <div className={`progress-step ${step.done ? 'done' : ''}`}>
                    <span className="progress-step-indicator">
                      {step.done ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      ) : step.step === 'generating' ? (
                        <span className="progress-step-pulse" />
                      ) : (
                        <span className="progress-step-empty" />
                      )}
                    </span>
                    <span className="progress-step-message">{step.message}</span>
                  </div>
                  {/* Show streaming AI thoughts whenever thinking is being streamed */}
                  {step.step === 'thinking' && (isThinking || thinkingText) && (
                    <div className="progress-step-thinking">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10"/>
                          <path d="M12 16v-4"/>
                          <path d="M12 8h.01"/>
                        </svg>
                        <span style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          {isThinking ? 'AI thinking...' : 'Thought process'}
                        </span>
                        {isThinking && <span className="thinking-spinner" />}
                      </div>
                      <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{thinkingText}</pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {(isThinking || thinkingText) && (
          <div className="thinking-panel">
            <div className="thinking-header">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 16v-4"/>
                <path d="M12 8h.01"/>
              </svg>
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
            <button type="button" className="action-btn primary" onClick={() => window.location.href = `/${summaryId}/chat`}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
              Chat about this
            </button>
            <button type="button" className="action-btn" onClick={copyLink}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
              </svg>
              Copy link
            </button>
          </div>
        )}

        {!loading && !streaming && !error && !displayedSummary && (
          <div className="empty-state">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" opacity="0.2">
              <polygon points="23 7 16 12 23 17 23 7"/>
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
            </svg>
            <p>Paste a YouTube URL to get started</p>
          </div>
        )}
      </div>
    </div>
  );
}

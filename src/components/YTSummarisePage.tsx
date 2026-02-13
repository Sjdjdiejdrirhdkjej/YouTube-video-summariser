import React from 'react';
import { marked } from 'marked';
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

  const [credits, setCredits] = React.useState<number | null>(null);
  const [sources, setSources] = React.useState<string[]>([]);

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
                const { step, message, thinking, timestamp } = parsed.progress;
                
                if (thinking) {
                  thinkingRef.current += thinking;
                  setThinkingText(thinkingRef.current);
                  setIsThinking(true);
                }
                
                if (message) {
                  const stepMap: Record<string, string> = {
                    'generating': 'analyzing',
                    'analyzing': 'analyzing',
                    'reasoning': 'reasoning',
                    'drafting': 'drafting',
                    'refining': 'refining',
                    'processing': 'processing',
                    'validating': 'validating',
                    'fallback': 'fallback',
                    'metadata': 'metadata',
                    'transcript': 'transcript',
                    'chapters': 'chapters',
                    'description': 'description',
                    'comments': 'comments',
                    'missing': 'missing',
                    'gathering': 'gathering',
                  };
                  const mappedStep = stepMap[step] || step;
                  
                  const granularSteps = ['analyzing', 'reasoning', 'drafting', 'refining', 'processing'];
                  if (granularSteps.includes(mappedStep)) {
                    setProgressSteps(prev => {
                      const hasGranular = prev.some(p => granularSteps.includes(p.step));
                      if (hasGranular && mappedStep !== 'thinking') {
                        const idx = prev.findIndex(p => p.step === mappedStep);
                        if (idx >= 0) {
                          const updated = [...prev];
                          updated[idx] = { ...updated[idx], message, done: step === 'complete', timestamp };
                          return updated;
                        }
                      }
                      return [...prev, { step: mappedStep, message, done: step === 'complete', timestamp }];
                    });
                  } else {
                    setProgressSteps(prev => {
                      const idx = prev.findIndex(p => p.step === step);
                      if (idx >= 0) {
                        const updated = [...prev];
                        updated[idx] = { step, message, done: step === 'complete', timestamp };
                        return updated;
                      }
                      return [...prev, { step, message, done: step === 'complete', timestamp }];
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
                if (Array.isArray(parsed.sources)) {
                  setSources(parsed.sources);
                }
                // Mark complete
                setProgressPercent(100);
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
        <div className="manus-nav-credits">
          {credits !== null ? `${credits} credits` : '\u00A0'}
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
          <div className="manus-progress">
            <div className="manus-progress-header">
              <span className="manus-progress-spinner" />
              <span>Generating summary...</span>
              {progressSteps.length > 0 && (
                <span className="manus-progress-time">
                  {elapsedSeconds < 5 ? 'just now' : elapsedSeconds < 60 ? `${elapsedSeconds}s elapsed` : `${Math.floor(elapsedSeconds / 60)}m ${elapsedSeconds % 60}s`}
                </span>
              )}
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
                Cancel
              </button>
            </div>
            <div className="manus-progress-bar-wrap">
              <div 
                className="manus-progress-bar" 
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div className="manus-progress-steps">
              {progressSteps.map((step, idx) => {
                const isCurrentStep = !step.done && idx === progressSteps.filter(p => p.done).length;
                return (
                  <div key={step.step + idx} className={isCurrentStep ? 'manus-progress-step--active' : ''}>
                    <div className={`manus-progress-step${step.done ? ' manus-progress-step--done' : ''}`}>
                      <span className="manus-step-indicator">
                        {step.done ? (
                          <span className="manus-step-check">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          </span>
                        ) : isCurrentStep ? (
                          <span className="manus-step-pulse" />
                        ) : (
                          <span className="manus-step-dot" />
                        )}
                      </span>
                      <span className="manus-step-message">{step.message}</span>
                      {step.timestamp && (
                        <span className="manus-step-timestamp">
                          {(() => {
                            const elapsed = Math.floor((Date.now() - step.timestamp) / 1000);
                            if (elapsed < 2) return '';
                            if (elapsed < 60) return `+${elapsed}s`;
                            return `+${Math.floor(elapsed / 60)}m`;
                          })()}
                        </span>
                      )}
                    </div>
                    {step.step === 'thinking' && (isThinking || thinkingText) && (
                      <div className="manus-step-thinking">
                        <div className="manus-step-thinking-header">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10" />
                            <path d="M12 16v-4" />
                            <path d="M12 8h.01" />
                          </svg>
                          <span className="manus-step-thinking-label">
                            {isThinking ? 'AI thinking...' : 'Thought process'}
                          </span>
                          {isThinking && <span className="manus-step-thinking-spinner" />}
                        </div>
                        <pre>{thinkingText}</pre>
                      </div>
                    )}
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

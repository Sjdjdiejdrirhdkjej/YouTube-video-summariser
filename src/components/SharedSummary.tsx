import React from 'react';
import { marked } from 'marked';

interface SharedSummaryProps {
  id: string;
  onBack: () => void;
}

export default function SharedSummary({ id, onBack }: SharedSummaryProps) {
  const [videoUrl, setVideoUrl] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [streaming, setStreaming] = React.useState(false);
  const [error, setError] = React.useState('');
  const [displayedSummary, setDisplayedSummary] = React.useState('');
  const summaryRef = React.useRef('');
  const animFrameRef = React.useRef(0);
  const abortRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;

    fetch(`/api/summary/${id}`, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error('Summary not found');
        return r;
      })
      .then((r) => {
        if (!r.body) throw new Error('Response body not available');

        const reader = r.body.getReader();
        const decoder = new TextDecoder();

        setLoading(false);
        setStreaming(true);
        summaryRef.current = '';
        setDisplayedSummary('');

        const tickAnimation = () => {
          const target = summaryRef.current;
          const idx = animFrameRef.current;
          if (idx < target.length) {
            const step = Math.min(3, target.length - idx);
            animFrameRef.current = idx + step;
            setDisplayedSummary(target.slice(0, idx + step));
          }
          animFrameRef.current = requestAnimationFrame(tickAnimation);
        };
        animFrameRef.current = requestAnimationFrame(tickAnimation);

        let buffer = '';
        let stopped = false;

        const processStream = async () => {
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
                if (parsed.id) setVideoUrl(parsed.videoUrl || '');
                if (parsed.summary) {
                  summaryRef.current += parsed.summary;
                }
              } catch {
                // ignore parse errors
              }
            }
          }
        };

        processStream()
          .finally(() => {
            cancelAnimationFrame(animFrameRef.current);
            setStreaming(false);
            setDisplayedSummary(summaryRef.current);
            try { reader.cancel(); } catch {}
          });
      })
      .catch((err) => {
        if ((err as Error)?.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
        setStreaming(false);
      });

    return () => {
      abortRef.current?.abort();
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [id]);

  const renderedHtml = React.useMemo(() => {
    if (!displayedSummary) return '';
    return marked.parse(displayedSummary) as string;
  }, [displayedSummary]);



  return (
    <div className="app-container">
      <header className="app-header">
        <h1>Video Summarizer</h1>
        <p>Shared Summary</p>
      </header>
      <main className="main-content">
        <div className="summary-output">
          <h2>Summary</h2>
          {loading && (
            <div className="summary-text loading-indicator">
              <span className="dot-pulse" />
              Loading summary...
            </div>
          )}
          {error && (
            <p className="summary-text error">
              {error}
            </p>
          )}
          {displayedSummary && (
            <>
              {videoUrl && (
                <p className="shared-video-link">
                  Video: <a href={videoUrl} target="_blank" rel="noopener noreferrer">{videoUrl}</a>
                </p>
              )}
              <p className="summary-id">
                Summary ID: <code>/{id}</code>
              </p>
              <div
                className={`summary-text markdown-body${streaming ? ' streaming' : ''}`}
                dangerouslySetInnerHTML={{ __html: renderedHtml }}
              />
              {streaming && (
                <p className="summary-text streaming-indicator">
                  <span className="dot-pulse" /> Streaming...
                </p>
              )}
            </>
          )}
        </div>
        <button type="button" className="summarize-btn" onClick={onBack}>
          Chat about it
        </button>
      </main>
    </div>
  );
}

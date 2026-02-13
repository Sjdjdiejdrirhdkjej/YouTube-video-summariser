import React from 'react';
import { marked } from 'marked';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatPageProps {
  id?: string;
  summaryId?: string;
  onBack: () => void;
}

export default function ChatPage({ id, summaryId, onBack }: ChatPageProps) {
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [summary, setSummary] = React.useState('');
  const [videoUrl, setVideoUrl] = React.useState('');
  const [input, setInput] = React.useState('');
  const [streaming, setStreaming] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [currentChatId, setCurrentChatId] = React.useState<string | null>(() => id || null);
  const [retryAfter, setRetryAfter] = React.useState(0);
  const [thinkingText, setThinkingText] = React.useState('');
  const [isThinking, setIsThinking] = React.useState(false);
  const thinkingRef = React.useRef('');
  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  const assistantRef = React.useRef('');
  const abortRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    if (id) {
      fetch(`/api/chat/${id}`)
        .then((r) => {
          if (!r.ok) throw new Error('Chat not found');
          return r.json();
        })
        .then((data) => {
          setMessages(data.messages || []);
          setSummary(data.summary || '');
          setVideoUrl(data.videoUrl || '');
        })
        .catch((err) => setError(err.message))
        .finally(() => setLoading(false));
    } else if (summaryId) {
      const controller = new AbortController();
      let fullSummary = '';
      let fullUrl = '';

      fetch(`/api/summary/${summaryId}`, { signal: controller.signal })
        .then((r) => {
          if (!r.ok) throw new Error('Summary not found');
          if (!r.body) throw new Error('Response body not available');

          const reader = r.body.getReader();
          const decoder = new TextDecoder();

          const processStream = async () => {
            let buffer = '';
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
                if (data === '[DONE]') break;

                try {
                  const parsed = JSON.parse(data);
                  if (parsed.videoUrl) fullUrl = parsed.videoUrl;
                  if (parsed.summary) fullSummary += parsed.summary;
                } catch {}
              }
            }

            try { reader.cancel(); } catch {}
          };

          return processStream();
        })
        .then(() => {
          setSummary(fullSummary);
          setVideoUrl(fullUrl);
        })
        .catch((err) => {
          if ((err as Error)?.name !== 'AbortError') {
            setError(err.message);
          }
        })
        .finally(() => {
          setLoading(false);
        });

      return () => controller.abort();
    }
  }, [id, summaryId]);

  React.useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  React.useEffect(() => {
    if (retryAfter <= 0) return;
    const timer = setInterval(() => {
      setRetryAfter((prev) => prev <= 1 ? 0 : prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [retryAfter > 0]);

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || streaming) return;

    const userMessage: Message = { role: 'user', content: text };
    const history = [...messages, userMessage];
    setMessages(history);
    setInput('');
    setStreaming(true);
    assistantRef.current = '';
    thinkingRef.current = '';
    setThinkingText('');
    setIsThinking(false);
    setMessages([...history, { role: 'assistant', content: '' }]);

    try {
      const abortController = new AbortController();
      abortRef.current = abortController;

      const fp = localStorage.getItem('device_fingerprint') || '';
      const body: Record<string, unknown> = { message: text };
      if (currentChatId) {
        body.chatId = currentChatId;
      } else {
        body.summary = summary;
        body.videoUrl = videoUrl;
        body.history = messages;
      }

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Fingerprint': fp },
        body: JSON.stringify(body),
        signal: abortController.signal,
      });

      if (!res.ok) {
        try {
          const data = await res.json();
          if (data.retryAfter) setRetryAfter(data.retryAfter);
          assistantRef.current = data.error;
        } catch {
          assistantRef.current = `Request failed (${res.status})`;
        }
        setMessages([...history, { role: 'assistant', content: assistantRef.current }]);
        setStreaming(false);
        return;
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) { setStreaming(false); return; }

      let buffer = '';
      let stopped = false;

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
          if (data === '[DONE]') { stopped = true; break; }

          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              if (parsed.retryAfter) setRetryAfter(parsed.retryAfter);
              assistantRef.current = parsed.error;
              setMessages([...history, { role: 'assistant', content: assistantRef.current }]);
              stopped = true;
              break;
            }
            if (parsed.credits !== undefined) {
              window.dispatchEvent(new CustomEvent('credits-update', { detail: parsed.credits }));
            }
            if (parsed.chatId) {
              setCurrentChatId(parsed.chatId);
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
              assistantRef.current += parsed.text;
              setMessages([...history, { role: 'assistant', content: assistantRef.current }]);
            }
          } catch {}
        }
      }
      try { await reader.cancel(); } catch {}
      setThinkingText('');
      setIsThinking(false);
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') { setStreaming(false); return; }
      assistantRef.current = `Error: ${err instanceof Error ? err.message : String(err)}`;
      setMessages([...messages, userMessage, { role: 'assistant', content: assistantRef.current }]);
    }
    setStreaming(false);
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>VidGist</h1>
        <p>{id ? 'Chat conversation' : 'Chat about this video'}</p>
      </header>
      <main className="main-content">
        {loading && <p className="summary-text">Loading...</p>}
        {error && <p className="summary-text error">{error}</p>}
        {!loading && !error && (
          <>
            {videoUrl && (
              <p className="shared-video-link">
                Video: <a href={videoUrl} target="_blank" rel="noopener noreferrer">{videoUrl}</a>
              </p>
            )}
            <div className="chat-page-panel">
              <div className="chat-messages chat-page-messages">
                {messages.length === 0 && (
                  <p className="chat-empty">{id ? 'No messages yet.' : 'Ask a question about the video summary.'}</p>
                )}
                {messages.map((msg, i) => (
                  <div key={i} className={`chat-message ${msg.role}`}>
                    {msg.role === 'assistant' ? (
                      <div
                        className="markdown-body"
                        dangerouslySetInnerHTML={{ __html: marked.parse(msg.content) as string }}
                      />
                    ) : (
                      <p>{msg.content}</p>
                    )}
                  </div>
                ))}
                {(isThinking || (thinkingText && streaming)) && (
                  <div className="thinking-panel compact">
                    <div className="thinking-header">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                      <span>{isThinking ? 'Thinking...' : 'Thought process'}</span>
                      {isThinking && <span className="thinking-spinner" />}
                    </div>
                    <pre className="thinking-content">{thinkingText}</pre>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
              <div className="chat-input-area">
                <input
                  type="text"
                  className="chat-input"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                  placeholder={id ? 'Continue the conversation...' : 'Ask about the summary...'}
                  disabled={streaming || retryAfter > 0}
                />
                <button
                  type="button"
                  className="chat-send-btn"
                  onClick={handleSend}
                  disabled={streaming || !input.trim() || retryAfter > 0}
                >
                  {streaming ? '...' : retryAfter > 0 ? `${retryAfter}s` : 'Send'}
                </button>
              </div>
            </div>
          </>
        )}
        <button type="button" className="summarize-btn" style={{ marginTop: '1rem' }} onClick={onBack}>
          Back to home
        </button>
      </main>
    </div>
  );
}

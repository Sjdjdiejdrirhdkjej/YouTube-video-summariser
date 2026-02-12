import React from 'react';
import { marked } from 'marked';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatProps {
  summary: string;
  videoUrl: string;
  onClose: () => void;
}

export default function Chat({ summary, videoUrl, onClose }: ChatProps) {
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [input, setInput] = React.useState('');
  const [streaming, setStreaming] = React.useState(false);
  const [retryAfter, setRetryAfter] = React.useState(0);
  const [chatId, setChatId] = React.useState<string | null>(null);
  const [thinkingText, setThinkingText] = React.useState('');
  const [isThinking, setIsThinking] = React.useState(false);
  const thinkingRef = React.useRef('');
  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  const assistantRef = React.useRef('');
  const abortRef = React.useRef<AbortController | null>(null);

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
    const updateMessages = (updater: (prev: Message[]) => Message[]) => {
      setMessages(prev => updater(prev));
    };

    updateMessages(prev => [...prev, userMessage]);
    setInput('');
    setStreaming(true);
    assistantRef.current = '';
    thinkingRef.current = '';
    setThinkingText('');
    setIsThinking(false);

    updateMessages(prev => [...prev, { role: 'assistant', content: '' }]);

    try {
      const abortController = new AbortController();
      abortRef.current = abortController;

      const fp = localStorage.getItem('device_fingerprint') || '';
      const body: Record<string, unknown> = { message: text };
      if (chatId) {
        body.chatId = chatId;
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
        updateMessages(prev => {
          const newMessages = [...prev];
          newMessages[newMessages.length - 1] = { role: 'assistant', content: assistantRef.current };
          return newMessages;
        });
        setStreaming(false);
        return;
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) {
        setStreaming(false);
        return;
      }

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
          if (data === '[DONE]') {
            stopped = true;
            break;
          }

          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              if (parsed.retryAfter) setRetryAfter(parsed.retryAfter);
              assistantRef.current = parsed.error;
              updateMessages(prev => {
                const newMessages = [...prev];
                newMessages[newMessages.length - 1] = { role: 'assistant', content: assistantRef.current };
                return newMessages;
              });
              stopped = true;
              break;
            }
            if (parsed.credits !== undefined) {
              window.dispatchEvent(new CustomEvent('credits-update', { detail: parsed.credits }));
            }
            if (parsed.chatId) {
              setChatId(parsed.chatId);
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
              updateMessages(prev => {
                const newMessages = [...prev];
                newMessages[newMessages.length - 1] = { role: 'assistant', content: assistantRef.current };
                return newMessages;
              });
            }
          } catch {}
        }
      }

      try { await reader.cancel(); } catch {}
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        setStreaming(false);
        return;
      }
      assistantRef.current = `Error: ${err instanceof Error ? err.message : String(err)}`;
      updateMessages(prev => {
        const newMessages = [...prev];
        newMessages[newMessages.length - 1] = { role: 'assistant', content: assistantRef.current };
        return newMessages;
      });
    }
    setThinkingText('');
    setStreaming(false);
  };

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <h3>Chat about this video</h3>
        <div className="chat-header-actions">
          {chatId && (
            <button
              type="button"
              className="chat-link-btn"
              onClick={() => {
                const url = `${window.location.origin}/chat/${chatId}`;
                navigator.clipboard.writeText(url);
              }}
            >
              Copy link
            </button>
          )}
          <button type="button" className="chat-close-btn" onClick={onClose}>
            ×
          </button>
        </div>
      </div>
      <div className="chat-messages">
        {messages.length === 0 && (
          <p className="chat-empty">Ask a question about the video summary.</p>
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
          placeholder="Ask about the video..."
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
  );
}

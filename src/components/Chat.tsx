import React from 'react';
import { marked } from 'marked';
import { useError } from '../context/ErrorContext';
import { puterClient } from '../lib/puterClient';

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
  const { addError } = useError();
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

    // Check Puter auth for real mode
    if (!puterClient.isSignedIn() && import.meta.env.VITE_PUTER_MOCK !== '1') {
      alert('Please sign in with Puter to use chat');
      return;
    }

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

      // Prepare messages for Puter
      const puterMessages = [
        { role: 'system' as const, content: `You are discussing a YouTube video. Summary: ${summary}\nVideo URL: ${videoUrl}` },
        ...messages.map(msg => ({ role: msg.role as 'user' | 'assistant', content: msg.content })),
        { role: 'user' as const, content: text }
      ];

      // Stream response from Puter
      const stream = puterClient.chatStream(puterMessages, { stream: true });
      const iterator = stream[Symbol.asyncIterator]();
      const AI_STALL_MS = 45_000;
      const AI_OVERALL_MS = 120_000;
      const aiStart = Date.now();
      let stallTimer: ReturnType<typeof setTimeout> | undefined;

      try {
        while (!abortController.signal.aborted) {
          if (Date.now() - aiStart > AI_OVERALL_MS) {
            throw new Error('AI response timed out after 2 minutes. Please try again.');
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
            assistantRef.current += event.text;
            updateMessages(prev => {
              const newMessages = [...prev];
              newMessages[newMessages.length - 1] = { role: 'assistant', content: assistantRef.current };
              return newMessages;
            });
          }
        }
      } finally {
        clearTimeout(stallTimer);
        iterator.return?.(undefined);
      }

      if (abortController.signal.aborted) {
        setStreaming(false);
        return;
      }

      // Persist chat after completion
      if (assistantRef.current && !chatId) {
        try {
          const persistRes = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              videoUrl,
              summary,
              messages: [...messages, { role: 'user', content: text }, { role: 'assistant', content: assistantRef.current }]
            }),
          });

          if (persistRes.ok) {
            const { chatId: newChatId } = await persistRes.json();
            setChatId(newChatId);
          }
        } catch (e) {
          console.error('Failed to persist chat:', e);
        }
      }

      setStreaming(false);
    } catch (err) {
      addError(err);
      assistantRef.current = err instanceof Error ? err.message : String(err);
      updateMessages(prev => {
        const newMessages = [...prev];
        newMessages[newMessages.length - 1] = { role: 'assistant', content: assistantRef.current };
        return newMessages;
      });
      setStreaming(false);
    }
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

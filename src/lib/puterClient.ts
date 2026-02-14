/**
 * Puter.js v2 client wrapper using CDN-loaded global SDK
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface StreamingEvent {
  thinking?: string;
  text?: string;
}

export interface PuterClientOptions {
  model?: string;
  stream?: boolean;
}

function getPuter(): Record<string, any> | null {
  return (window as any).puter ?? null;
}

function waitForPuter(timeout = 10000): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const existing = getPuter();
    if (existing) {
      resolve(existing);
      return;
    }
    const start = Date.now();
    const poll = () => {
      const p = getPuter();
      if (p) {
        resolve(p);
      } else if (Date.now() - start > timeout) {
        reject(new Error('Puter.js SDK failed to load'));
      } else {
        setTimeout(poll, 100);
      }
    };
    poll();
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

class PuterClient {
  private isMockMode: boolean;
  private signedIn: boolean = false;
  private sdkReady: Promise<Record<string, any> | null>;
  private availableModels: string[] = [];
  private preferredModels = [
    'claude-sonnet-4',
    'gpt-4o',
    'claude-3-5-sonnet-20241022'
  ];

  constructor() {
    this.isMockMode = import.meta.env.VITE_PUTER_MOCK === '1';

    if (!this.isMockMode && typeof window !== 'undefined') {
      this.sdkReady = waitForPuter().then(async (puter) => {
        try {
          const signed = await puter.auth.isSignedIn();
          this.signedIn = !!signed;
        } catch {
          this.signedIn = false;
        }
        return puter;
      }).catch((err) => {
        console.error('Puter SDK init error:', err);
        return null;
      });
    } else {
      this.signedIn = true;
      this.sdkReady = Promise.resolve(null);
    }
  }

  async signIn(): Promise<void> {
    if (this.isMockMode) {
      this.signedIn = true;
      return;
    }

    const puter = getPuter() ?? await this.sdkReady;
    if (!puter) throw new Error('Puter.js SDK not loaded');

    await puter.auth.signIn();
    this.signedIn = true;
    await this.cacheAvailableModels();
  }

  isSignedIn(): boolean {
    return this.signedIn;
  }

  async whenReady(): Promise<boolean> {
    await this.sdkReady;
    return this.signedIn;
  }

  private async cacheAvailableModels(): Promise<void> {
    if (this.isMockMode) return;
    const puter = getPuter();
    if (!puter) return;

    try {
      const models = await puter.ai.listModels();
      this.availableModels = Array.isArray(models) ? models : [];
    } catch (err) {
      console.warn('Failed to fetch available models:', err);
      this.availableModels = [];
    }
  }

  private getBestModel(): string {
    if (this.isMockMode) {
      return 'claude-sonnet-4';
    }

    for (const model of this.preferredModels) {
      if (this.availableModels.includes(model)) {
        return model;
      }
    }

    return this.preferredModels[0];
  }

  async *chatStream(messages: ChatMessage[], options: PuterClientOptions = {}): AsyncGenerator<StreamingEvent> {
    const { stream = true, model } = options;

    if (this.isMockMode) {
      yield* this.mockChatStream(messages);
      return;
    }

    const puter = await this.sdkReady;
    if (!puter || !this.signedIn) {
      throw new Error('Not signed in to Puter');
    }

    const modelsToTry = model ? [model] : [...this.preferredModels];
    let lastError: Error | null = null;

    for (const selectedModel of modelsToTry) {
      try {
        console.log(`[Puter AI] Trying model: ${selectedModel}`);

        const response = await withTimeout(
          puter.ai.chat(messages, { model: selectedModel, stream }),
          60_000,
          `Puter AI request timed out after 60s (model: ${selectedModel})`
        );

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const respAny = response as any;
        console.log(`[Puter AI] Response received — type: ${typeof response}, asyncIterable: ${!!respAny?.[Symbol.asyncIterator]}`);

        if (stream && respAny && typeof respAny === 'object' && Symbol.asyncIterator in respAny) {
          for await (const chunk of respAny as AsyncIterable<{ reasoning?: string; text?: string }>) {
            if (chunk?.reasoning) {
              yield { thinking: chunk.reasoning };
            }
            if (chunk?.text) {
              yield { text: chunk.text };
            }
          }
          return;
        } else if (typeof response === 'string') {
          yield { text: response };
          return;
        } else if (respAny && typeof respAny === 'object') {
          const resp = respAny as { message?: { content?: string }; text?: string };
          if (resp.message?.content) {
            yield { text: resp.message.content };
            return;
          } else if (resp.text) {
            yield { text: resp.text };
            return;
          }
        }
        throw new Error(`Unrecognized response format from Puter AI (model: ${selectedModel})`);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[Puter AI] Model ${selectedModel} failed: ${message}`);
        lastError = err instanceof Error ? err : new Error(message);
      }
    }

    throw lastError || new Error('All Puter AI models failed');
  }

  private async *mockChatStream(messages: ChatMessage[]): AsyncGenerator<StreamingEvent> {
    if (messages.length > 0 && messages[messages.length - 1].role === 'user') {
      yield { thinking: 'Analyzing request and formulating response...' };
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    const mockResponse = `## Mock Response\n\nThis is a deterministic mock response for testing.\n\n**User Query:** "${messages[messages.length - 1]?.content || 'No query'}"\n\n**Response:** This demonstrates Puter.js v2 streaming in mock mode. No actual API calls were made.`;

    const chunkSize = 20;
    for (let i = 0; i < mockResponse.length; i += chunkSize) {
      yield { text: mockResponse.slice(i, i + chunkSize) };
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  async *summarizeStream(prompt: string, options: PuterClientOptions = {}): AsyncGenerator<StreamingEvent> {
    const messages: ChatMessage[] = [
      { role: 'user', content: prompt }
    ];

    yield* this.chatStream(messages, options);
  }
}

export const puterClient = new PuterClient();

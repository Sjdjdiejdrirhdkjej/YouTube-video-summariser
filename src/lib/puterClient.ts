/**
 * Puter.js v2 client wrapper with mock mode support
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

class PuterClient {
  private puter: any = null;
  private isMockMode: boolean;
  private signedIn: boolean = false;
  private availableModels: string[] = [];
  private preferredModels = [
    'claude-sonnet-4',
    'gpt-4o',
    'claude-sonnet-4-5'
  ];

  constructor() {
    this.isMockMode = import.meta.env.VITE_PUTER_MOCK === '1';
    
    if (!this.isMockMode && typeof window !== 'undefined') {
      // Load Puter SDK dynamically
      import('@heyputer/puter.js').then((puterModule) => {
        this.puter = puterModule;
        this.checkAuthStatus();
      }).catch((err) => {
        console.error('Failed to load Puter.js SDK:', err);
      });
    } else {
      // Mock mode: always signed in
      this.signedIn = true;
    }
  }

  private async checkAuthStatus(): Promise<void> {
    if (!this.puter) return;
    
    try {
      this.signedIn = await this.puter.auth.isSignedIn();
    } catch (err) {
      console.error('Failed to check auth status:', err);
      this.signedIn = false;
    }
  }

  async signIn(): Promise<void> {
    if (this.isMockMode) {
      this.signedIn = true;
      return;
    }

    if (!this.puter) {
      throw new Error('Puter.js SDK not loaded');
    }

    try {
      await this.puter.auth.signIn();
      this.signedIn = true;
      
      // Cache available models after sign-in
      await this.cacheAvailableModels();
    } catch (err) {
      console.error('Sign in failed:', err);
      throw err;
    }
  }

  isSignedIn(): boolean {
    return this.signedIn;
  }

  private async cacheAvailableModels(): Promise<void> {
    if (!this.puter || this.isMockMode) return;

    try {
      const models = await this.puter.ai.listModels();
      this.availableModels = Array.isArray(models) ? models : [];
    } catch (err) {
      console.warn('Failed to fetch available models:', err);
      this.availableModels = [];
    }
  }

  private getBestModel(): string {
    if (this.isMockMode) {
      return 'claude-opus-4-5-thinking';
    }

    // Check cached models first
    for (const model of this.preferredModels) {
      if (this.availableModels.includes(model)) {
        return model;
      }
    }

    // Fallback to first preferred model
    return this.preferredModels[0];
  }

  async *chatStream(messages: ChatMessage[], options: PuterClientOptions = {}): AsyncGenerator<StreamingEvent> {
    const { stream = true, model } = options;
    const selectedModel = model || this.getBestModel();

    if (this.isMockMode) {
      // Mock streaming for testing
      yield* this.mockChatStream(messages);
      return;
    }

    if (!this.puter || !this.signedIn) {
      throw new Error('Not signed in to Puter');
    }

    try {
      const response = await this.puter.ai.chat(messages, {
        model: selectedModel,
        stream,
      });

      if (stream && response[Symbol.asyncIterator]) {
        for await (const chunk of response) {
          if (chunk?.reasoning) {
            yield { thinking: chunk.reasoning };
          }
          if (chunk?.text) {
            yield { text: chunk.text };
          }
        }
      } else if (typeof response === 'string') {
        yield { text: response };
      } else if (response?.message?.content) {
        yield { text: response.message.content };
      } else if (response?.text) {
        yield { text: response.text };
      }
    } catch (err: any) {
      if (err.message?.includes('model not found') || err.message?.includes('invalid model')) {
        // Try next model
        const nextModelIndex = this.preferredModels.indexOf(selectedModel) + 1;
        if (nextModelIndex < this.preferredModels.length) {
          console.log(`Model ${selectedModel} not found, trying ${this.preferredModels[nextModelIndex]}`);
          yield* this.chatStream(messages, { ...options, model: this.preferredModels[nextModelIndex] });
          return;
        }
      }
      throw err;
    }
  }

  private async *mockChatStream(messages: ChatMessage[]): AsyncGenerator<StreamingEvent> {
    // Simulate thinking for first message
    if (messages.length > 0 && messages[messages.length - 1].role === 'user') {
      yield { thinking: 'Analyzing request and formulating response...' };
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Generate deterministic mock response
    const mockResponse = `## Mock Response\n\nThis is a deterministic mock response for testing.\n\n**User Query:** "${messages[messages.length - 1]?.content || 'No query'}"\n\n**Response:** This demonstrates Puter.js v2 streaming in mock mode. No actual API calls were made.`;

    // Stream response in chunks
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

// Singleton instance
export const puterClient = new PuterClient();
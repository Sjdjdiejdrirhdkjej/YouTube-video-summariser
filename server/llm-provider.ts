/**
 * LLM Provider Abstraction Layer
 * 
 * Provides a unified interface for LLM providers.
 * Currently supports Puter.js v2.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface StreamingEvent {
  thinking?: string;
  text?: string;
}

export interface LLMProvider {
  summarizeStream(prompt: string): AsyncGenerator<StreamingEvent>;
  chatStream(messages: ChatMessage[]): AsyncGenerator<StreamingEvent>;
  isAvailable(): boolean;
  getName(): string;
}

/**
 * Puter.js v2 Provider Implementation
 */
export class PuterJSProvider implements LLMProvider {
  private puter: any;
  private authToken: string;

  constructor(authToken: string) {
    this.authToken = authToken;
    if (authToken) {
      const { init } = require('@heyputer/puter.js/src/init.cjs');
      this.puter = init(authToken);
    }
  }

  isAvailable(): boolean {
    return !!this.authToken && !!this.puter;
  }

  getName(): string {
    return 'puterjs';
  }

  async *summarizeStream(prompt: string): AsyncGenerator<StreamingEvent> {
    if (!this.isAvailable()) {
      throw new Error('Puter.js provider not available');
    }

    const messages: ChatMessage[] = [
      { role: 'user', content: prompt }
    ];

    yield* this.chatStream(messages);
  }

  async *chatStream(messages: ChatMessage[]): AsyncGenerator<StreamingEvent> {
    if (!this.isAvailable()) {
      throw new Error('Puter.js provider not available');
    }

    const response = await this.puter.ai.chat(
      messages.map(msg => ({ role: msg.role, content: msg.content })),
      {
        model: 'claude-sonnet-4',
        stream: true,
      }
    );

    if (response[Symbol.asyncIterator]) {
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
    }
  }
}

/**
 * Provider Factory
 */
export class LLMProviderFactory {
  static createPuterJSProvider(authToken: string): PuterJSProvider {
    return new PuterJSProvider(authToken);
  }

  static createProvider(config: {
    puterAuthToken?: string;
    preferredProvider?: 'puterjs';
  }): LLMProvider | null {
    const { puterAuthToken } = config;
    
    if (puterAuthToken) {
      const provider = new PuterJSProvider(puterAuthToken);
      if (provider.isAvailable()) return provider;
    }
    
    return null;
  }
}

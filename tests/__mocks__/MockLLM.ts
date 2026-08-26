import { SimpleLLM, Message, Tool } from '../../src/llm';

export class MockLLM extends SimpleLLM {
  private responseOverrides: Map<string, string> = new Map();
  private failNextWith: (Error & { response?: { status: number } }) | null = null;
  private hangNext = false;
  private queuedResponse: { content: string; toolCalls?: any[] } | null = null;

  constructor() {
    // Pass a dummy key/model directly so no GOOGLE_API_KEY env lookup happens.
    super('mock-key', 'mock-model');
  }

  async complete(
    messages: Message[],
    tools?: Tool[]
  ): Promise<{ content: string; toolCalls?: any[] }> {
    (this as any).callCount++;

    if (this.hangNext) {
      // Never resolves - used to exercise Bee's timeout handling.
      return new Promise<{ content: string; toolCalls?: any[] }>(() => {});
    }

    if (this.failNextWith) {
      const error = this.failNextWith;
      this.failNextWith = null;
      throw error;
    }

    if (this.queuedResponse) {
      const response = this.queuedResponse;
      this.queuedResponse = null;
      (this as any).totalTokens += 100;
      return response;
    }

    const lastMessage = messages[messages.length - 1];
    const key = lastMessage.content.substring(0, 50);

    if (this.responseOverrides.has(key)) {
      const content = this.responseOverrides.get(key)!;
      (this as any).totalTokens += 100;
      return { content, toolCalls: [] };
    }

    const content = this.getMockResponse(lastMessage.content);
    (this as any).totalTokens += 100;

    return { content, toolCalls: [] };
  }

  private getMockResponse(prompt: string): string {
    if (prompt.includes('classify')) {
      return JSON.stringify({
        classification: 'NORMAL',
        priority: 'medium'
      });
    }
    if (prompt.includes('respond')) {
      return 'Here is a professional response...';
    }
    if (prompt.includes('execute')) {
      return 'Action executed successfully';
    }
    return 'Default mock response';
  }

  setResponseOverride(prompt: string, response: string): void {
    this.responseOverrides.set(prompt, response);
  }

  /** Makes the next complete() call return this exact response (including tool calls). */
  respondOnceWith(response: { content: string; toolCalls?: any[] }): void {
    this.queuedResponse = response;
  }

  /** Makes the next complete() call reject with the given error. */
  failNext(error: Error & { response?: { status: number } }): void {
    this.failNextWith = error;
  }

  /** Makes the next complete() call never resolve, to exercise timeouts. */
  hangNextCall(): void {
    this.hangNext = true;
  }

  getTokens(): number {
    return (this as any).totalTokens;
  }

  getCallCount(): number {
    return (this as any).callCount;
  }

  resetStats(): void {
    (this as any).totalTokens = 0;
    (this as any).callCount = 0;
  }
}

import { SimpleLLM } from '../../src/llm/SimpleLLM';
import { Message, Tool } from '../../src/types';
import { LLMAdapter } from '../../src/providers/LLMAdapter';

export class MockLLM extends SimpleLLM implements LLMAdapter {
  readonly name = 'mock';

  private responseOverrides: Map<string, string> = new Map();
  private failNextWith: (Error & { response?: { status: number } }) | null = null;
  private hangNext = false;
  private queuedResponses: { content: string; toolCalls?: any[] }[] = [];
  private nextDelayMs = 0;

  constructor() {
    // Pass a dummy key/model directly so no GOOGLE_API_KEY env lookup happens.
    super('mock-key', 'mock-model');
  }

  async complete(
    messages: Message[],
    tools?: Tool[]
  ): Promise<{ content: string; toolCalls?: any[] }> {
    (this as any).callCount++;

    if (this.nextDelayMs > 0) {
      const delay = this.nextDelayMs;
      this.nextDelayMs = 0;
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    if (this.hangNext) {
      // Never resolves - used to exercise Bee's timeout handling.
      return new Promise<{ content: string; toolCalls?: any[] }>(() => {});
    }

    if (this.failNextWith) {
      const error = this.failNextWith;
      this.failNextWith = null;
      throw error;
    }

    if (this.queuedResponses.length > 0) {
      const response = this.queuedResponses.shift()!;
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

  /**
   * Queues an exact response (including tool calls) for the next
   * complete() call. Call it multiple times in a row to script a
   * sequence of responses across several iterations/calls - each
   * consumed in FIFO order before falling back to the default mock
   * response logic.
   */
  respondOnceWith(response: { content: string; toolCalls?: any[] }): void {
    this.queuedResponses.push(response);
  }

  /** Makes the next complete() call reject with the given error. */
  failNext(error: Error & { response?: { status: number } }): void {
    this.failNextWith = error;
  }

  /** Makes the next complete() call never resolve, to exercise timeouts. */
  hangNextCall(): void {
    this.hangNext = true;
  }

  /** Makes the next complete() call take `ms` before resolving. */
  delayNext(ms: number): void {
    this.nextDelayMs = ms;
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

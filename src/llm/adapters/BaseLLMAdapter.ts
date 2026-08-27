import { Message, Tool } from '../../types';
import { LLMAdapter, LLMResponse } from '../../providers/LLMAdapter';

/** Shared bookkeeping (token/call counters, model name) for every concrete adapter. */
export abstract class BaseLLMAdapter implements LLMAdapter {
  abstract readonly name: string;
  protected model: string;
  protected totalTokens = 0;
  protected callCount = 0;

  constructor(model: string) {
    this.model = model;
  }

  abstract complete(messages: Message[], tools?: Tool[]): Promise<LLMResponse>;

  protected trackUsage(tokens: number): void {
    this.totalTokens += tokens;
    this.callCount++;
  }

  getTokens(): number {
    return this.totalTokens;
  }

  getCallCount(): number {
    return this.callCount;
  }

  resetStats(): void {
    this.totalTokens = 0;
    this.callCount = 0;
  }

  setModel(model: string): void {
    this.model = model;
  }

  getModel(): string {
    return this.model;
  }
}

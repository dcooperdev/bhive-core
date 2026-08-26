import { ContextProvider } from '../../src/providers/ContextProvider';
import { EventPublisher } from '../../src/providers/EventBus';
import { BeeEvent } from '../../src/types';

/** Records every published event in-memory, for assertions in tests. */
export class RecordingEventPublisher implements EventPublisher {
  readonly name = 'recording';
  public events: BeeEvent[] = [];

  async publish(event: BeeEvent): Promise<void> {
    this.events.push(event);
  }

  eventsOfType(type: string): BeeEvent[] {
    return this.events.filter(e => e.type === type);
  }
}

/** Minimal in-memory ContextProvider for exercising Bee's context persistence. */
export class TestContextProvider implements ContextProvider {
  readonly name = 'test-context';
  private store = new Map<string, unknown>();

  async getContext<T = unknown>(key: string): Promise<T | undefined> {
    return this.store.get(key) as T | undefined;
  }

  async setContext<T = unknown>(key: string, value: T): Promise<void> {
    this.store.set(key, value);
  }

  async deleteContext(key: string): Promise<void> {
    this.store.delete(key);
  }

  async hasContext(key: string): Promise<boolean> {
    return this.store.has(key);
  }
}

import { BeeEvent } from '../types';
import { EventBus, BeeEventHandler } from '../providers/EventBus';

/**
 * InMemoryEventBus - EventBus backed by plain in-process listeners.
 *
 * Useful for development, tests, and single-instance deployments.
 * Subscribing with eventType '*' receives every published event.
 */
export class InMemoryEventBus implements EventBus {
  readonly name = 'memory';

  private handlers = new Map<string, Set<BeeEventHandler>>();

  async publish(event: BeeEvent): Promise<void> {
    const listeners = [
      ...(this.handlers.get(event.type) ?? []),
      ...(this.handlers.get('*') ?? [])
    ];

    for (const handler of listeners) {
      try {
        await handler(event);
      } catch (error) {
        console.error(`   ⚠️  EventBus handler error for "${event.type}": ${(error as Error).message}`);
      }
    }
  }

  subscribe(eventType: string, handler: BeeEventHandler): () => void {
    const set = this.handlers.get(eventType) ?? new Set<BeeEventHandler>();
    set.add(handler);
    this.handlers.set(eventType, set);

    return () => {
      this.handlers.get(eventType)?.delete(handler);
    };
  }
}

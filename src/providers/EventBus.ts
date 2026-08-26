import { BeeEvent } from '../types';

export type BeeEventHandler = (event: BeeEvent) => void | Promise<void>;

/**
 * EventPublisher - Agnostic outbound side of the event bus.
 *
 * Bees publish lifecycle events (run started/completed/failed, queue
 * full, retries, ...) through this interface so any backend (Redis,
 * Kafka, WebSocket, an in-memory emitter, ...) can observe them.
 */
export interface EventPublisher {
  readonly name: string;
  publish(event: BeeEvent): Promise<void>;
}

/**
 * EventSubscriber - Agnostic inbound side of the event bus.
 *
 * `eventType` may be a concrete BeeEventType or '*' to receive every
 * event. Returns an unsubscribe function.
 */
export interface EventSubscriber {
  readonly name: string;
  subscribe(eventType: string, handler: BeeEventHandler): () => void;
}

export interface EventBus extends EventPublisher, EventSubscriber {}

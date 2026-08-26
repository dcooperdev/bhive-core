import { InMemoryEventBus } from '../../src/events/InMemoryEventBus';
import { BeeEvent } from '../../src/types';

function makeEvent(type: BeeEvent['type'] = 'run:complete'): BeeEvent {
  return { id: '1', timestamp: new Date(), beeName: 'test-bee', type, data: {} };
}

describe('InMemoryEventBus', () => {
  it('should deliver a published event to a matching subscriber', async () => {
    const bus = new InMemoryEventBus();
    const received: BeeEvent[] = [];
    bus.subscribe('run:complete', event => { received.push(event); });

    await bus.publish(makeEvent());

    expect(received).toHaveLength(1);
  });

  it('should deliver every event to a wildcard subscriber', async () => {
    const bus = new InMemoryEventBus();
    const received: BeeEvent[] = [];
    bus.subscribe('*', event => { received.push(event); });

    await bus.publish(makeEvent('run:start'));
    await bus.publish(makeEvent('run:error'));

    expect(received).toHaveLength(2);
  });

  it('should stop delivering events once unsubscribed', async () => {
    const bus = new InMemoryEventBus();
    const received: BeeEvent[] = [];
    const unsubscribe = bus.subscribe('run:complete', event => { received.push(event); });

    unsubscribe();
    await bus.publish(makeEvent());

    expect(received).toHaveLength(0);
  });

  it('should not let one throwing handler stop the others', async () => {
    const bus = new InMemoryEventBus();
    const received: BeeEvent[] = [];
    bus.subscribe('run:complete', () => {
      throw new Error('handler exploded');
    });
    bus.subscribe('run:complete', event => { received.push(event); });

    await expect(bus.publish(makeEvent())).resolves.toBeUndefined();
    expect(received).toHaveLength(1);
  });
});

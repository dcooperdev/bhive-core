jest.mock('axios');

import axios from 'axios';
import { BeeManager } from '../src/bee/BeeManager';
import { InMemoryStorage } from '../src/storage/InMemoryStorage';
import { InMemoryEventBus } from '../src/events/InMemoryEventBus';
import { testEmails } from './fixtures/emails';
import { mockClassifyTool, mockLabelTool } from './fixtures/tools';

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('Integration: BeeManager + Bee workflow', () => {
  let beeManager: BeeManager;

  beforeEach(() => {
    mockedAxios.post.mockResolvedValue({
      data: {
        candidates: [{ content: { parts: [{ text: 'Mocked LLM response' }] } }],
        usageMetadata: { totalTokenCount: 30 }
      }
    });

    beeManager = new BeeManager('gemini-1.5-flash', { apiKey: 'test-api-key' });
  });

  it('should execute full email manager workflow', async () => {
    // Create Bees for Email Manager Hive
    beeManager.createBee({
      name: 'classifier',
      prompt: 'Classify this email',
      tools: [mockClassifyTool]
    });

    beeManager.createBee({
      name: 'responder',
      prompt: 'Generate response',
      tools: []
    });

    beeManager.createBee({
      name: 'executor',
      prompt: 'Execute actions',
      tools: [mockLabelTool]
    });

    // Process email
    const taskInput = `Process email from ${testEmails.vip.from}`;
    const result = await beeManager.executeTask(taskInput, [
      'classifier',
      'responder',
      'executor'
    ]);

    expect(result['classifier']).toBeDefined();
    expect(result['responder']).toBeDefined();
    expect(result['executor']).toBeDefined();
  });

  it('should handle plan upgrade gracefully', async () => {
    // Create bee with free tier limits
    beeManager.createBee({
      name: 'classifier',
      prompt: 'Classify',
      tools: []
    });

    const bee = beeManager.getBee('classifier');
    const freeConfig = bee?.getConfig();

    // Upgrade plan
    beeManager.restart('gemini-1.5-pro');

    const proConfig = bee?.getConfig();

    expect(freeConfig?.requestsPerMinute).toBe(60);
    expect(proConfig?.requestsPerMinute).toBe(120);
  });

  it('should coordinate multiple bees in sequence', async () => {
    // Create 5 bees
    for (let i = 1; i <= 5; i++) {
      beeManager.createBee({
        name: `bee${i}`,
        prompt: `Task ${i}`,
        tools: []
      });
    }

    // Execute all together
    const result = await beeManager.executeTask('Task', [
      'bee1',
      'bee2',
      'bee3',
      'bee4',
      'bee5'
    ]);

    expect(Object.keys(result)).toHaveLength(5);
  });

  it('should process all three sample emails end to end', async () => {
    beeManager.createBee({
      name: 'classifier',
      prompt: 'Classify this email',
      tools: [mockClassifyTool]
    });

    for (const email of Object.values(testEmails)) {
      const result = await beeManager.executeTask(
        `Process email from ${email.from}: ${email.subject}`,
        ['classifier']
      );
      expect(result['classifier']).toBeDefined();
    }

    expect(beeManager.getBee('classifier')?.getRuns()).toHaveLength(3);
  });
});

describe('Integration: multi-instance with shared providers', () => {
  beforeEach(() => {
    mockedAxios.post.mockResolvedValue({
      data: {
        candidates: [{ content: { parts: [{ text: 'Mocked LLM response' }] } }],
        usageMetadata: { totalTokenCount: 12 }
      }
    });
  });

  it('should let two separate BeeManager instances share a storage-backed queue', async () => {
    const sharedStorage = new InMemoryStorage();
    const queueConfig = { persist: true, persistenceKey: 'shared:worker-queue' };

    const instanceA = new BeeManager('gemini-1.5-flash', {
      apiKey: 'test-api-key',
      storageProvider: sharedStorage
    });
    const instanceB = new BeeManager('gemini-1.5-flash', {
      apiKey: 'test-api-key',
      storageProvider: sharedStorage
    });

    instanceA.createBee({ name: 'worker', prompt: 'Work', tools: [], queueConfig });
    instanceB.createBee({ name: 'worker', prompt: 'Work', tools: [], queueConfig });

    await instanceA.getBee('worker')!.run('Task from instance A');
    await instanceB.getBee('worker')!.run('Task from instance B');

    // Both instances processed their own work against the same shared key,
    // and the queue is fully drained once both are done.
    expect(await sharedStorage.listLength('shared:worker-queue')).toBe(0);
  });

  it('should let two separate BeeManager instances observe each other through a shared event bus', async () => {
    const sharedEvents = new InMemoryEventBus();
    const seen: string[] = [];
    sharedEvents.subscribe('*', event => {
      seen.push(`${event.beeName}:${event.type}`);
    });

    const instanceA = new BeeManager('gemini-1.5-flash', {
      apiKey: 'test-api-key',
      eventPublisher: sharedEvents
    });
    const instanceB = new BeeManager('gemini-1.5-flash', {
      apiKey: 'test-api-key',
      eventPublisher: sharedEvents
    });

    instanceA.createBee({ name: 'worker-a', prompt: 'Work', tools: [] });
    instanceB.createBee({ name: 'worker-b', prompt: 'Work', tools: [] });

    await instanceA.getBee('worker-a')!.run('Task from A');
    await instanceB.getBee('worker-b')!.run('Task from B');

    expect(seen).toContain('worker-a:run:complete');
    expect(seen).toContain('worker-b:run:complete');
  });

  it('should reject work on one instance once a shared queue is already at capacity from another', async () => {
    const sharedStorage = new InMemoryStorage();
    const queueConfig = { persist: true, persistenceKey: 'shared:full-queue', maxSize: 1 };

    // Simulate a backlog another instance already left in the shared queue.
    await sharedStorage.pushToList('shared:full-queue', {
      id: 'pending-from-instance-a',
      input: 'still queued',
      enqueuedAt: Date.now()
    });

    const instanceB = new BeeManager('gemini-1.5-flash', {
      apiKey: 'test-api-key',
      storageProvider: sharedStorage
    });
    instanceB.createBee({ name: 'worker', prompt: 'Work', tools: [], queueConfig });

    await expect(instanceB.getBee('worker')!.run('New task')).rejects.toThrow(/Queue full/);
  });
});

jest.mock('axios');

import axios from 'axios';
import { BeeManager } from '../src/bee/BeeManager';
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

    beeManager = new BeeManager('gemini-1.5-flash', 'test-api-key');
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

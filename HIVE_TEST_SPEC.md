# HIVE FRAMEWORK - Complete Test Suite Specification

## Test Strategy

- **Unit Tests**: Test each component in isolation (BeeConfig, Bee, BeeManager, SimpleLLM)
- **Integration Tests**: Test components working together (Bee + BeeManager, Bee + LLM)
- **Mock LLM**: Never call real API in tests, use MockLLM for reproducible results
- **Coverage Goal**: 100% coverage on critical paths (BeeConfig, Bee, BeeManager)

## Directory Structure

HiveJS/
├── src/
│ ├── bee/
│ ├── types.ts
│ ├── llm.ts
│ └── index.ts
├── tests/
│ ├── mocks/
│ │ └── MockLLM.ts
│ ├── fixtures/
│ │ ├── emails.ts
│ │ └── tools.ts
│ ├── bee/
│ │ ├── BeeConfig.test.ts
│ │ ├── Bee.test.ts
│ │ └── BeeManager.test.ts
│ ├── llm/
│ │ └── SimpleLLM.test.ts
│ └── integration.test.ts
├── jest.config.js
├── package.json
└── README.md


## package.json (Updated)

```json
{
  "name": "@bhive/core",
  "version": "0.1.0",
  "description": "Hive - Multi-Agent AI Framework with Auto-Configurable Bees",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage",
    "test:ci": "jest --ci --coverage"
  },
  "keywords": ["ai", "agents", "hive", "bees"],
  "author": "Your Name",
  "license": "Apache-2.0",
  "dependencies": {
    "axios": "^1.6.0",
    "dotenv": "^16.0.0"
  },
  "devDependencies": {
    "@types/jest": "^29.0.0",
    "@types/node": "^20.0.0",
    "jest": "^29.0.0",
    "ts-jest": "^29.0.0",
    "typescript": "^5.0.0"
  }
}
```

## jest.config.js

```javascript
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1'
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/index.ts',
    '!src/**/*.d.ts'
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  }
};
```

## tests/__mocks__/MockLLM.ts

```typescript
import { SimpleLLM, Message, Tool } from '../../src/llm';

export class MockLLM extends SimpleLLM {
  private responseOverrides: Map<string, string> = new Map();

  constructor() {
    // Don't call parent constructor to avoid API key requirement
    (this as any).apiKey = 'mock-key';
    (this as any).model = 'mock-model';
    (this as any).baseURL = 'mock://api';
    (this as any).totalTokens = 0;
    (this as any).callCount = 0;
  }

  async complete(
    messages: Message[],
    tools?: Tool[]
  ): Promise<{ content: string; toolCalls?: any[] }> {
    (this as any).callCount++;

    // Check if response override exists
    const lastMessage = messages[messages.length - 1];
    const key = lastMessage.content.substring(0, 50);
    
    if (this.responseOverrides.has(key)) {
      const content = this.responseOverrides.get(key)!;
      (this as any).totalTokens += 100; // Mock tokens
      return { content, toolCalls: [] };
    }

    // Default mock responses based on prompt
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
```

## tests/fixtures/tools.ts

```typescript
import { Tool } from '../../src/types';

export const mockClassifyTool: Tool = {
  name: 'classify_email',
  description: 'Classify email as VIP, SPAM, or NORMAL',
  execute: async (params: { from: string; subject: string }) => {
    const vips = ['boss@company.com', 'ceo@company.com'];
    if (vips.some(v => params.from.includes(v))) {
      return JSON.stringify({ classification: 'VIP' });
    }
    return JSON.stringify({ classification: 'NORMAL' });
  }
};

export const mockLabelTool: Tool = {
  name: 'apply_label',
  description: 'Apply label to email',
  execute: async (params: { emailId: string; label: string }) => {
    return `Labeled ${params.emailId} as ${params.label}`;
  }
};

export const mockNotifyTool: Tool = {
  name: 'notify_user',
  description: 'Notify user',
  execute: async (params: { message: string }) => {
    return `Notified: ${params.message}`;
  }
};

export const allMockTools = [
  mockClassifyTool,
  mockLabelTool,
  mockNotifyTool
];
```

## tests/fixtures/emails.ts

```typescript
export const testEmails = {
  vip: {
    id: '1',
    from: 'boss@company.com',
    subject: 'Quarterly Review'
  },
  spam: {
    id: '2',
    from: 'newsletter@marketing.com',
    subject: 'LIMITED TIME OFFER'
  },
  normal: {
    id: '3',
    from: 'friend@mail.com',
    subject: 'Coffee next week?'
  }
};
```

## tests/bee/BeeConfig.test.ts

```typescript
import { BeeConfig } from '../../src/bee/BeeConfig';

describe('BeeConfig', () => {
  let beeConfig: BeeConfig;

  beforeEach(() => {
    beeConfig = new BeeConfig();
  });

  describe('getModelLimits', () => {
    it('should return limits for known model: gemini-1.5-flash', () => {
      const limits = beeConfig.getModelLimits('gemini-1.5-flash');
      
      expect(limits).toBeDefined();
      expect(limits.name).toBe('Gemini 1.5 Flash');
      expect(limits.requestsPerMinute).toBe(60);
      expect(limits.recommendedDelayMs).toBe(1000);
      expect(limits.maxTokensPerRequest).toBe(8000);
      expect(limits.timeout).toBe(30000);
    });

    it('should return limits for gemini-1.5-pro', () => {
      const limits = beeConfig.getModelLimits('gemini-1.5-pro');
      
      expect(limits.requestsPerMinute).toBe(120);
      expect(limits.recommendedDelayMs).toBe(500);
      expect(limits.maxTokensPerRequest).toBe(16000);
    });

    it('should return limits for groq-mixtral', () => {
      const limits = beeConfig.getModelLimits('mixtral-8x7b-32768');
      
      expect(limits.requestsPerMinute).toBe(300);
      expect(limits.recommendedDelayMs).toBe(200);
    });

    it('should return conservative defaults for unknown model', () => {
      const limits = beeConfig.getModelLimits('unknown-model-xyz');
      
      expect(limits.name).toBe('Unknown Model');
      expect(limits.requestsPerMinute).toBe(10);
      expect(limits.recommendedDelayMs).toBe(5000);
      expect(limits.maxTokensPerRequest).toBe(2048);
    });

    it('should have cost estimates for free-tier models', () => {
      const gemini = beeConfig.getModelLimits('gemini-1.5-flash');
      const groq = beeConfig.getModelLimits('mixtral-8x7b-32768');
      
      expect(gemini.estimatedCostPer1kTokens.input).toBeGreaterThan(0);
      expect(groq.estimatedCostPer1kTokens.input).toBe(0); // Groq free
    });
  });

  describe('updateModelLimits', () => {
    it('should update limits for existing model', () => {
      const newLimits = {
        name: 'Updated Model',
        maxTokensPerRequest: 10000,
        maxTokensPerMinute: 100000,
        requestsPerMinute: 200,
        estimatedCostPer1kTokens: { input: 0.5, output: 1 },
        recommendedBatchSize: 5,
        recommendedDelayMs: 300,
        timeout: 25000
      };

      beeConfig.updateModelLimits('gemini-1.5-flash', newLimits);
      const updated = beeConfig.getModelLimits('gemini-1.5-flash');

      expect(updated.name).toBe('Updated Model');
      expect(updated.requestsPerMinute).toBe(200);
      expect(updated.recommendedDelayMs).toBe(300);
    });
  });

  describe('getRegisteredModels', () => {
    it('should return list of all registered models', () => {
      const models = beeConfig.getRegisteredModels();
      
      expect(models).toContain('gemini-1.5-flash');
      expect(models).toContain('gemini-1.5-pro');
      expect(models).toContain('mixtral-8x7b-32768');
      expect(models).toContain('gpt-4o-mini');
    });
  });
});
```

## tests/bee/Bee.test.ts

```typescript
import { Bee } from '../../src/bee/Bee';
import { BeeConfig } from '../../src/bee/BeeConfig';
import { MockLLM } from '../__mocks__/MockLLM';
import { mockClassifyTool, mockLabelTool } from '../fixtures/tools';

describe('Bee', () => {
  let bee: Bee;
  let beeConfig: BeeConfig;
  let mockLLM: MockLLM;

  beforeEach(() => {
    beeConfig = new BeeConfig();
    mockLLM = new MockLLM();
  });

  describe('constructor', () => {
    it('should initialize with auto-detected config', () => {
      bee = new Bee(
        'classifier',
        'You classify emails',
        [mockClassifyTool],
        mockLLM as any,
        beeConfig,
        'gemini-1.5-flash'
      );

      expect(bee.getName()).toBe('classifier');
      const config = bee.getConfig();
      expect(config.requestsPerMinute).toBe(60);
      expect(config.recommendedDelayMs).toBe(1000);
    });

    it('should use conservative defaults for unknown model', () => {
      bee = new Bee(
        'analyzer',
        'You analyze data',
        [],
        mockLLM as any,
        beeConfig,
        'unknown-model'
      );

      const config = bee.getConfig();
      expect(config.requestsPerMinute).toBe(10);
      expect(config.recommendedDelayMs).toBe(5000);
    });
  });

  describe('run', () => {
    beforeEach(() => {
      bee = new Bee(
        'test-bee',
        'You respond to input',
        [],
        mockLLM as any,
        beeConfig,
        'gemini-1.5-flash'
      );
    });

    it('should execute input and return output', async () => {
      const result = await bee.run('Test input');
      
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    it('should track runs', async () => {
      await bee.run('Test 1');
      await bee.run('Test 2');

      const runs = bee.getRuns();
      expect(runs).toHaveLength(2);
      expect(runs[0].input).toBe('Test 1');
      expect(runs[1].input).toBe('Test 2');
    });

    it('should respect rate limiting delay', async () => {
      const startTime = Date.now();
      await bee.run('Test 1');
      await bee.run('Test 2');
      const elapsed = Date.now() - startTime;

      // Should have applied delay between requests
      // Exact timing may vary, but should be at least close to delay
      expect(elapsed).toBeGreaterThan(100); // Allow some margin
    });
  });

  describe('updateConfig', () => {
    beforeEach(() => {
      bee = new Bee(
        'test-bee',
        'Test',
        [],
        mockLLM as any,
        beeConfig,
        'gemini-1.5-flash'
      );
    });

    it('should update config after plan change', () => {
      const oldConfig = bee.getConfig();
      expect(oldConfig.requestsPerMinute).toBe(60);

      const newConfig = beeConfig.getModelLimits('gemini-1.5-pro');
      bee.updateConfig(newConfig);

      const updatedConfig = bee.getConfig();
      expect(updatedConfig.requestsPerMinute).toBe(120);
      expect(updatedConfig.recommendedDelayMs).toBe(500);
    });
  });

  describe('getInfo', () => {
    beforeEach(() => {
      bee = new Bee(
        'test-bee',
        'Test',
        [],
        mockLLM as any,
        beeConfig,
        'gemini-1.5-flash'
      );
    });

    it('should return bee info', async () => {
      await bee.run('Test');
      const info = bee.getInfo();

      expect(info.name).toBe('test-bee');
      expect(info.model).toBe('Gemini 1.5 Flash');
      expect(info.delayMs).toBe(1000);
      expect(info.rateLimitPerMin).toBe(60);
      expect(info.runs).toBe(1);
    });
  });
});
```

## tests/bee/BeeManager.test.ts

```typescript
import { BeeManager, BeeDefinition } from '../../src/bee/BeeManager';
import { MockLLM } from '../__mocks__/MockLLM';
import { mockClassifyTool, mockLabelTool } from '../fixtures/tools';

describe('BeeManager', () => {
  let beeManager: BeeManager;

  beforeEach(() => {
    beeManager = new BeeManager('gemini-1.5-flash');
  });

  describe('constructor', () => {
    it('should initialize with model', () => {
      expect(beeManager).toBeDefined();
    });
  });

  describe('createBee', () => {
    it('should create and register bee', () => {
      const def: BeeDefinition = {
        name: 'classifier',
        prompt: 'Classify emails',
        tools: [mockClassifyTool]
      };

      const bee = beeManager.createBee(def);

      expect(bee).toBeDefined();
      expect(bee.getName()).toBe('classifier');
      expect(beeManager.getBee('classifier')).toBe(bee);
    });

    it('should create multiple bees', () => {
      beeManager.createBee({
        name: 'classifier',
        prompt: 'Classify',
        tools: []
      });

      beeManager.createBee({
        name: 'responder',
        prompt: 'Respond',
        tools: []
      });

      expect(beeManager.getBee('classifier')).toBeDefined();
      expect(beeManager.getBee('responder')).toBeDefined();
    });
  });

  describe('executeTask', () => {
    beforeEach(() => {
      beeManager.createBee({
        name: 'bee1',
        prompt: 'Task 1',
        tools: []
      });

      beeManager.createBee({
        name: 'bee2',
        prompt: 'Task 2',
        tools: []
      });
    });

    it('should execute task with single bee', async () => {
      const result = await beeManager.executeTask('Test task', ['bee1']);

      expect(result).toBeDefined();
      expect(result['bee1']).toBeDefined();
    });

    it('should execute task with multiple bees', async () => {
      const result = await beeManager.executeTask(
        'Process email',
        ['bee1', 'bee2']
      );

      expect(result['bee1']).toBeDefined();
      expect(result['bee2']).toBeDefined();
    });

    it('should handle missing bee gracefully', async () => {
      const result = await beeManager.executeTask('Test', ['nonexistent']);

      // Should not throw, just skip missing bee
      expect(result).toBeDefined();
    });
  });

  describe('restart', () => {
    beforeEach(() => {
      beeManager.createBee({
        name: 'classifier',
        prompt: 'Classify',
        tools: []
      });
    });

    it('should reconfigure bees on restart', () => {
      const bee = beeManager.getBee('classifier');
      const oldConfig = bee?.getConfig();

      beeManager.restart('gemini-1.5-pro');

      const newConfig = bee?.getConfig();
      expect(newConfig?.requestsPerMinute).toBe(120);
      expect(newConfig?.requestsPerMinute).not.toBe(
        oldConfig?.requestsPerMinute
      );
    });

    it('should update rate limits in memory', () => {
      const bee = beeManager.getBee('classifier');

      beeManager.restart('mixtral-8x7b-32768');

      const config = bee?.getConfig();
      expect(config?.requestsPerMinute).toBe(300);
      expect(config?.recommendedDelayMs).toBe(200);
    });
  });

  describe('getBeeStats', () => {
    beforeEach(() => {
      beeManager.createBee({
        name: 'bee1',
        prompt: 'Test',
        tools: []
      });

      beeManager.createBee({
        name: 'bee2',
        prompt: 'Test',
        tools: []
      });
    });

    it('should return stats for all bees', () => {
      const stats = beeManager.getBeeStats();

      expect(stats['bee1']).toBeDefined();
      expect(stats['bee2']).toBeDefined();
      expect(stats['bee1'].name).toBe('bee1');
      expect(stats['bee2'].name).toBe('bee2');
    });
  });
});
```

## tests/llm/SimpleLLM.test.ts

```typescript
import { SimpleLLM } from '../../src/llm';

// Note: These tests use mock responses, not real API
describe('SimpleLLM', () => {
  it('should require API key', () => {
    // Save original env
    const original = process.env.GOOGLE_API_KEY;
    delete process.env.GOOGLE_API_KEY;

    expect(() => {
      new SimpleLLM();
    }).toThrow('GOOGLE_API_KEY not set');

    // Restore
    process.env.GOOGLE_API_KEY = original;
  });

  it('should accept API key in constructor', () => {
    const llm = new SimpleLLM('test-key');
    expect(llm).toBeDefined();
  });

  it('should track token count', () => {
    const llm = new SimpleLLM('test-key');
    expect(llm.getTokens()).toBe(0);
    expect(llm.getCallCount()).toBe(0);
  });

  it('should reset stats', () => {
    const llm = new SimpleLLM('test-key');
    llm.resetStats();

    expect(llm.getTokens()).toBe(0);
    expect(llm.getCallCount()).toBe(0);
  });

  // Note: Actual API calls should be tested with real API or mocked HTTP
  // Add integration tests in integration.test.ts if needed
});
```

## tests/integration.test.ts

```typescript
import { BeeManager } from '../src/bee/BeeManager';
import { MockLLM } from './__mocks__/MockLLM';
import { testEmails } from './fixtures/emails';
import { mockClassifyTool, mockLabelTool } from './fixtures/tools';

describe('Integration: BeeManager + Bee workflow', () => {
  let beeManager: BeeManager;

  beforeEach(() => {
    beeManager = new BeeManager('gemini-1.5-flash');
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

  it('should coordinate multiple bees in parallel', async () => {
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
});
```

## Running Tests

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage

# CI mode
npm run test:ci
```

## Test Coverage Goals

- BeeConfig: 100% (all models, defaults, updates)
- Bee: 100% (auto-config, rate limiting, retries, errors)
- BeeManager: 100% (create, execute, restart, stats)
- SimpleLLM: 100% (token tracking, error handling)
- Integration: 100% (real workflows)
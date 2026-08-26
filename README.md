# 🐝 Hive - Multi-Agent AI Framework

`@hiveai/core`: a multi-agent AI framework where each Bee auto-configures
its rate limits, delays, and timeouts from the model it's given — no
manual tuning required.

## Quick Start

### 1. Install Dependencies
npm install

### 2. Setup .env
cp .env.example .env
# Edit .env and add your Google (Gemini) API key

### 3. Build
npm run build

### 4. Run Tests
npm test

## Usage

```typescript
import { BeeManager } from '@hiveai/core';

const beeManager = new BeeManager('gemini-1.5-flash');

beeManager.createBee({
  name: 'classifier',
  prompt: 'Classify emails as WORK/SPAM/NORMAL',
  tools: [classifyTool]
});

await beeManager.executeTask('Process email: ...', ['classifier']);

// Plan upgraded? Reconfigure every Bee in memory, no restart of the process needed.
beeManager.restart('gemini-1.5-pro');
```

## Features
- Auto-detected rate limits, delays, and timeouts per model (`BeeConfig`)
- Per-Bee request queueing so calls never overlap
- Exponential backoff retry on 503 errors
- Timeout handling per model
- Token/cost tracking and a `printSummary()` / `getBeeStats()` report
- In-memory `restart()` to reconfigure all Bees after a plan change

## Architecture
See [HIVE_SPEC.md](./HIVE_SPEC.md) for the full design and [HIVE_TEST_SPEC.md](./HIVE_TEST_SPEC.md) for the test strategy.

```
src/
├── bee/
│   ├── BeeConfig.ts   — model limits registry + auto-detection
│   ├── Bee.ts         — individual auto-configured agent
│   └── BeeManager.ts  — global orchestrator
├── types.ts           — Tool, Message, ToolCall, AgentRun
├── llm.ts             — SimpleLLM wrapper around the Gemini API
└── index.ts           — public package exports
```

## Testing

```bash
npm test              # run all tests
npm run test:watch    # watch mode
npm run test:coverage # coverage report
npm run test:ci       # CI mode (coverage thresholds enforced)
```

Tests never call the real Gemini API — `axios` and `SimpleLLM` are mocked
(`tests/__mocks__/MockLLM.ts`) so results are fast and reproducible.

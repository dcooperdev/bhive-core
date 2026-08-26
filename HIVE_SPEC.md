# HIVE FRAMEWORK - Architecture & Implementation Guide

## Executive Summary

Hive is a multi-agent AI framework where:
- **Bees** = Individual intelligent agents that auto-configure based on model limits
- **Hives** = Collections of Bees solving specific use cases (Email Manager, Social Media, Payment, etc)
- **BeeManager** = Orchestrator that detects model limits on startup and adapts automatically

**Key Innovation**: Each Bee automatically detects its model's rate limits, token limits, and timeout on initialization. If the API plan changes, restart BeeManager and all Bees reconfigure in memory.

---

## Architecture Overview

┌─────────────────────────────────────────────────────┐
│ BeeManager (Global Orchestrator) │
├─────────────────────────────────────────────────────┤
│ │
│ On Startup: │
│ 1. Detect model (e.g., gemini-1.5-flash) │
│ 2. Load auto-detected limits from BeeConfig │
│ 3. Create Bees with auto-config │
│ 4. All Bees respect rate limits automatically │
│ │
│ On Plan Change: │
│ beeManager.restart('gemini-1.5-pro') │
│ → All Bees reconfigure in memory │
│ → New rate limits take effect immediately │
│ │
└─────────────────────────────────────────────────────┘
↓
┌────┴────┬────────┬──────────┐
│ │ │ │
Bee1 Bee2 Bee3 BeeN
(Auto) (Auto) (Auto) (Auto)
Classify Respond Execute Analyze
Rate:60 Rate:60 Rate:60 Rate:60
Delay: Delay: Delay: Delay:
1000ms 1000ms 1000ms 1000ms


---

## Component Details

### BeeConfig - Auto-Detection Engine

**Purpose**: Detect model limits automatically on app startup

**How it works**:
1. Maintains a registry of known models with their limits
2. When BeeManager initializes, it calls beeConfig.getModelLimits(modelName)
3. BeeConfig returns auto-detected limits for that model
4. If model unknown, returns conservative defaults

**Registry includes**:
- gemini-1.5-flash: 60 req/min, 1000ms delay
- gemini-1.5-pro: 120 req/min, 500ms delay
- groq-mixtral: 300 req/min, 200ms delay
- gpt-4o-mini: 500 req/min, 100ms delay

**When plan changes**:

User upgrades from free to pro
→ beeManager.updateModelLimits('gemini-1.5-pro', newLimits)
→ beeConfig stores new limits in memory
→ beeManager.restart() reloads all Bees
→ All Bees now use pro tier limits


### Bee - Intelligent Individual Agent

**Purpose**: Execute a specific task with auto-configured rate limiting

**What makes a Bee smart**:
1. **Auto-configured**: Loads limits from BeeConfig on init
2. **Rate-aware**: Respects requestsPerMinute automatically
3. **Timeout-safe**: Has timeout per model
4. **Retry logic**: Exponential backoff on 503 errors
5. **Queue-aware**: Manages request queue to avoid overwhelming API

**Bee lifecycle**:
Constructor: Load limits from BeeConfig
→ "🐝 Bee classifier initialized"
→ "Rate limit: 60 req/min"
→ "Delay: 1000ms"
run(input): Execute with rate limiting
→ Check time since last request
→ Apply delay if needed
→ Execute LLM call
→ Queue next request if waiting
Error handling:
→ 503 error? Double delay and retry
→ Timeout? Return error message
→ Other error? Log and fail gracefully

**Configuration auto-loaded from model**:
```typescript
// Bee doesn't need explicit config
const bee = beeManager.createBee({
  name: 'classifier',
  prompt: '...',
  tools: [...],
  model: 'gemini-1.5-flash' // BeeConfig auto-detects limits
});

// Bee automatically knows:
// - 60 requests/minute max
// - 1000ms delay between requests
// - 30 second timeout
// - 8000 tokens max per request
```

### BeeManager - Global Orchestrator

**Purpose**: Initialize, configure, and manage all Bees

**Responsibilities**:
1. Initialize BeeConfig and LLM on startup
2. Detect model and auto-load limits
3. Create Bees with auto-configuration
4. Provide unified task execution
5. Handle plan changes (restart Bees)
6. Monitor stats and health

**Key methods**:

```typescript
// Initialize with model name
const beeManager = new BeeManager('gemini-1.5-flash');
// → Auto-detects limits
// → Creates global LLM instance
// → Ready to create Bees

// Create individual Bee (auto-configured)
beeManager.createBee({
  name: 'classifier',
  prompt: 'You classify emails',
  tools: [classifyTool]
  // model: 'gemini-1.5-flash' (uses default if not specified)
});

// Execute task with multiple Bees
await beeManager.executeTask(
  'Classify and respond to email',
  ['classifier', 'responder']
);

// Plan changed? Restart everything
beeManager.restart('gemini-1.5-pro');
// → Reloads all Bees with new limits
// → All Bees now use pro tier config

// Get stats
beeManager.printSummary();
// → Shows each Bee's config
// → Shows rate limits
// → Shows number of runs
```

---

## Use Cases - How Hives Are Built

### Email Manager Hive (3 Bees)

```typescript
const beeManager = new BeeManager('gemini-1.5-flash');

// Bee 1: Classifier (auto-configured)
beeManager.createBee({
  name: 'classifier',
  prompt: 'Classify emails as VIP/SPAM/NORMAL',
  tools: [classifyTool, notifyTool]
});

// Bee 2: Responder (auto-configured)
beeManager.createBee({
  name: 'responder',
  prompt: 'Generate professional email responses',
  tools: [suggestReplyTool]
});

// Bee 3: Executor (auto-configured)
beeManager.createBee({
  name: 'executor',
  prompt: 'Execute actions on emails',
  tools: [labelTool, archiveTool]
});

// Execute Email Manager workflow
async function emailManagerHive(email) {
  // All 3 Bees run in sequence, each with auto-configured rate limits
  return await beeManager.executeTask(
    `Process email: ${email.subject}`,
    ['classifier', 'responder', 'executor']
  );
}
```

**What happens automatically**:
- Classifier Bee starts: Respects 60 req/min, applies 1000ms delay
- Responder Bee starts: Respects 60 req/min, applies 1000ms delay
- Executor Bee starts: Respects 60 req/min, applies 1000ms delay
- All configured in memory, no manual rate limiting needed

### Social Media Hive (3 Bees)

```typescript
beeManager.createBee({
  name: 'trend_detector',
  prompt: 'Detect trending topics about Hive',
  tools: [twitterSearchTool, githubTrendTool]
});

beeManager.createBee({
  name: 'content_generator',
  prompt: 'Generate engaging posts about Hive',
  tools: [generatePostTool]
});

beeManager.createBee({
  name: 'publisher',
  prompt: 'Publish to Twitter and Dev.to',
  tools: [tweetTool, devtoTool]
});

async function socialMediaHive() {
  return await beeManager.executeTask(
    'Create and publish post about Hive trends',
    ['trend_detector', 'content_generator', 'publisher']
  );
}
```

---

## Data Flow

### Startup Flow
App starts
↓
const beeManager = new BeeManager('gemini-1.5-flash')
├─ BeeConfig.getModelLimits('gemini-1.5-flash')
│ └─ Returns: {name, rate, delay, timeout, ...}
├─ SimpleLLM initialized with model
└─ Ready to create Bees
↓
beeManager.createBee({name: 'classifier', ...})
├─ new Bee(name, prompt, tools, llm, beeConfig, modelName)
├─ Bee loads limits: beeConfig.getModelLimits('gemini-1.5-flash')
├─ Bee stores: config.requestsPerMinute = 60
├─ Bee stores: config.recommendedDelayMs = 1000
└─ Bee ready with auto-configuration

### Execution Flow
await bee.run('Process this email')
↓
Bee checks: time since last request
├─ If < 1000ms: wait
└─ Else: execute immediately
↓
LLM call: await llm.complete(messages, tools)
├─ Make API call
├─ Receive response
└─ Parse response
↓
Execute tool calls (if any)
└─ Store results
↓
Return output to caller
↓
Next request in queue processes

### Plan Change Flow
User upgrades from free to pro
↓
Code calls: beeManager.restart('gemini-1.5-pro')
↓
BeeManager:
├─ Updates LLM model to 'gemini-1.5-pro'
├─ For each Bee:
│ ├─ Calls beeConfig.getModelLimits('gemini-1.5-pro')
│ ├─ Receives: {rate: 120, delay: 500, ...}
│ └─ Bee.updateConfig(newLimits)
└─ All Bees now use pro limits in memory
↓
Next requests use new rate limits automatically

---

## Key Design Decisions

### 1. Auto-Detection Over Manual Config

**Why**: Developers shouldn't have to manually set rate limits
**How**: BeeConfig registry + getModelLimits() on init

### 2. In-Memory Config Over External Storage

**Why**: Faster, simpler, resets on restart
**How**: Map<modelName, ModelLimits> in BeeConfig

### 3. Per-Bee Rate Limiting Over Global

**Why**: Each Bee can have different delays
**How**: Each Bee tracks lastRequestTime and applies own delay

### 4. Queue-Based Processing Over Parallel

**Why**: Respects rate limits, prevents API overload
**How**: Each Bee has requestQueue, processes sequentially

### 5. Exponential Backoff Over Fixed Retry

**Why**: Adapts to temporary API issues
**How**: On 503 error, double the delay and retry

---

## File Structure & Responsibilities

src/
├── bee/
│ ├── BeeConfig.ts
│ │ └─ Registry of model limits
│ │ └─ getModelLimits(modelName) returns auto-detected config
│ │ └─ updateModelLimits() for plan changes
│ │
│ ├── Bee.ts
│ │ └─ Individual intelligent agent
│ │ └─ Auto-loads config from BeeConfig
│ │ └─ Manages request queue with rate limiting
│ │ └─ Handles retries and timeouts
│ │
│ └─ BeeManager.ts
│ └─ Global orchestrator
│ └─ Creates and manages Bees
│ └─ Coordinates task execution
│ └─ Handles plan changes (restart)
│
├── types.ts
│ └─ Tool, Message, ToolCall, AgentRun interfaces
│
├── llm.ts
│ └─ SimpleLLM wraps Google Gemini API
│ └─ Tracks tokens and costs
│ └─ Throws errors on API failures
│
└── poc.ts
└─ Demo: Email Manager Hive with auto-configured Bees


---

## Testing & Validation

The POC demonstrates:

✅ **Auto-configuration**: Bees load limits on init
✅ **Rate limiting**: Bees apply delays automatically
✅ **Queue management**: Multiple Bees respect order
✅ **Error handling**: 503 errors trigger backoff
✅ **Plan changes**: restart() reconfigures all Bees
✅ **Token tracking**: Cost per email is measurable

---

## Next Phase: Create Real Hives

Once framework is solid, create production Hives:

1. **Email Manager Hive** - Classify, respond, execute
2. **Social Media Hive** - Monitor trends, generate posts
3. **Payment Hive** - Process invoices, validate, pay
4. **GitHub Monitor Hive** - Track issues, notify, respond
5. **Marketplace Hive** - Recommend agents, negotiate prices

Each Hive:
- Composes 2-5 auto-configured Bees
- Solves specific business problem
- Respects API limits automatically
- Scales horizontally (more Hives, same framework)

---

## Summary

Hive is a framework where:
- **Bees** automatically configure themselves based on model limits
- **Hives** compose Bees to solve real problems
- **BeeManager** orchestrates everything and handles plan changes
- **No manual configuration** needed—everything auto-detects

- The innovation: When you change your API plan, call restart() once and all Bees instantly adapt.

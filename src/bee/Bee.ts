import { SimpleLLM } from '../llm';
import { Message, Tool, ToolCall, AgentRun } from '../types';
import { BeeConfig, ModelLimits } from './BeeConfig';

/**
 * Bee - Intelligent Individual Agent
 *
 * Auto-configures its rate limit, delay, timeout and max tokens from
 * BeeConfig on construction. Callers never set these manually.
 */
export class Bee {
  private name: string;
  private prompt: string;
  private tools: Tool[];
  private llm: SimpleLLM;
  private beeConfig: BeeConfig;
  private modelName: string;
  private maxIterations: number;

  private config: ModelLimits;
  private lastRequestTime = 0;
  private requestQueue: Promise<void> = Promise.resolve();

  public runs: AgentRun[] = [];

  constructor(
    name: string,
    prompt: string,
    tools: Tool[],
    llm: SimpleLLM,
    beeConfig: BeeConfig,
    modelName: string,
    maxIterations: number = 3
  ) {
    this.name = name;
    this.prompt = prompt;
    this.tools = tools;
    this.llm = llm;
    this.beeConfig = beeConfig;
    this.modelName = modelName;
    this.maxIterations = maxIterations;

    this.config = this.beeConfig.getModelLimits(this.modelName);

    console.log(`🐝 Bee "${this.name}" initialized`);
    console.log(`   Rate limit: ${this.config.requestsPerMinute} req/min`);
    console.log(`   Delay: ${this.config.recommendedDelayMs}ms`);
  }

  /**
   * Reconfigures this Bee in memory, e.g. after a plan change.
   * Called by BeeManager.restart().
   */
  updateConfig(newLimits: ModelLimits): void {
    this.config = newLimits;
    console.log(`   🔄 Bee "${this.name}" reconfigured`);
    console.log(`      Rate limit: ${this.config.requestsPerMinute} req/min`);
    console.log(`      Delay: ${this.config.recommendedDelayMs}ms`);
  }

  getName(): string {
    return this.name;
  }

  getConfig(): ModelLimits {
    return { ...this.config };
  }

  getRuns(): AgentRun[] {
    return this.runs;
  }

  getInfo(): {
    name: string;
    model: string;
    delayMs: number;
    rateLimitPerMin: number;
    runs: number;
  } {
    return {
      name: this.name,
      model: this.config.name,
      delayMs: this.config.recommendedDelayMs,
      rateLimitPerMin: this.config.requestsPerMinute,
      runs: this.runs.length
    };
  }

  /**
   * Executes a task, queued behind any in-flight run on this Bee so
   * requests are processed sequentially and never overlap.
   */
  async run(input: string): Promise<string> {
    const task = this.requestQueue.then(() => this.executeWithRateLimit(input));
    // executeWithRateLimit never rejects (it catches its own errors), so
    // the queue only ever needs to wait on it, never swallow a rejection.
    this.requestQueue = task.then(() => undefined);
    return task;
  }

  private async executeWithRateLimit(input: string): Promise<string> {
    await this.applyDelay();

    console.log(`\n[${this.name}] Running...`);
    console.log(`   Input: ${input}`);

    const messages: Message[] = [
      { role: 'user', content: `${this.prompt}\n\nTask: ${input}` }
    ];

    const toolCalls: ToolCall[] = [];
    let output = '';
    let iterations = 0;

    while (iterations < this.maxIterations) {
      iterations++;
      console.log(`   [Iteration ${iterations}/${this.maxIterations}]`);

      try {
        const response = await this.callWithRetry(messages);

        messages.push({ role: 'assistant', content: response.content });
        output = response.content;

        if (!response.toolCalls || response.toolCalls.length === 0) {
          console.log('   ✅ Bee finished (no more tool calls)');
          break;
        }

        for (const call of response.toolCalls) {
          const tool = this.tools.find(t => t.name === call.name);

          if (!tool) {
            console.log(`   ⚠️  Tool not found: ${call.name}`);
            continue;
          }

          try {
            const result = await tool.execute(call.params);

            console.log(`   → ${tool.name}(${JSON.stringify(call.params).substring(0, 40)})`);
            console.log(`   ← ${result.substring(0, 60)}`);

            toolCalls.push({ toolName: tool.name, params: call.params, result });

            messages.push({
              role: 'user',
              content: `Tool ${tool.name} returned: ${result}`
            });
          } catch (error) {
            console.error(`   ❌ Tool execution error: ${(error as Error).message}`);
          }
        }
      } catch (error) {
        console.error(`   ❌ Bee error: ${(error as Error).message}`);
        output = `Error: ${(error as Error).message}`;
        break;
      }
    }

    const run: AgentRun = {
      agent: this.name,
      input,
      toolCalls,
      output,
      tokensUsed: this.llm.getTokens(),
      timestamp: new Date()
    };

    this.runs.push(run);

    return output;
  }

  /**
   * Waits out any remaining delay since the last request before firing
   * the next one, per the auto-configured recommendedDelayMs.
   */
  private async applyDelay(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestTime;
    const remaining = this.config.recommendedDelayMs - elapsed;

    if (remaining > 0) {
      await sleep(remaining);
    }

    this.lastRequestTime = Date.now();
  }

  /**
   * Calls the LLM with the Bee's timeout, retrying with exponential
   * backoff on 503 (service unavailable / overloaded) errors.
   */
  private async callWithRetry(
    messages: Message[],
    delayMs: number = this.config.recommendedDelayMs
  ): Promise<{ content: string; toolCalls?: { name: string; params: any }[] }> {
    try {
      return await withTimeout(
        this.llm.complete(messages, this.tools),
        this.config.timeout
      );
    } catch (error) {
      const status = (error as any)?.response?.status;

      if (status === 503) {
        const nextDelay = delayMs * 2;
        console.log(`   ⏳ 503 received, backing off ${nextDelay}ms and retrying...`);
        await sleep(nextDelay);
        return this.callWithRetry(messages, nextDelay);
      }

      if ((error as Error).message === 'TIMEOUT') {
        throw new Error(`Timeout after ${this.config.timeout}ms`);
      }

      throw error;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('TIMEOUT')), ms);
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

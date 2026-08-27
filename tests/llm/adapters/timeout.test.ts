import { GeminiAdapter } from '../../../src/llm/adapters/GeminiAdapter';
import { OpenAIAdapter } from '../../../src/llm/adapters/OpenAIAdapter';
import { AnthropicAdapter } from '../../../src/llm/adapters/AnthropicAdapter';
import { OllamaAdapter } from '../../../src/llm/adapters/OllamaAdapter';
import { resolveTimeout, DEFAULT_ADAPTER_TIMEOUT_MS } from '../../../src/llm/adapters/BaseLLMAdapter';

const TIMEOUT_ENV_VARS = ['GEMINI_TIMEOUT', 'OPENAI_TIMEOUT', 'ANTHROPIC_TIMEOUT', 'OLLAMA_TIMEOUT', 'BEE_TIMEOUT'];

function clearTimeoutEnv() {
  for (const key of TIMEOUT_ENV_VARS) delete process.env[key];
}

describe('resolveTimeout precedence', () => {
  beforeEach(clearTimeoutEnv);
  afterEach(clearTimeoutEnv);

  it('defaults to 60s when nothing is set', () => {
    expect(resolveTimeout({ envVar: 'GEMINI_TIMEOUT' })).toBe(DEFAULT_ADAPTER_TIMEOUT_MS);
    expect(DEFAULT_ADAPTER_TIMEOUT_MS).toBe(60_000);
  });

  it('uses fallbackMs over the shared default', () => {
    expect(resolveTimeout({ envVar: 'OLLAMA_TIMEOUT', fallbackMs: 120_000 })).toBe(120_000);
  });

  it('BEE_TIMEOUT beats the default but loses to the provider-specific env var', () => {
    process.env.BEE_TIMEOUT = '45000';
    expect(resolveTimeout({ envVar: 'GEMINI_TIMEOUT' })).toBe(45000);

    process.env.GEMINI_TIMEOUT = '80000';
    expect(resolveTimeout({ envVar: 'GEMINI_TIMEOUT' })).toBe(80000);
  });

  it('an explicit value beats every env var', () => {
    process.env.GEMINI_TIMEOUT = '80000';
    process.env.BEE_TIMEOUT = '45000';
    expect(resolveTimeout({ envVar: 'GEMINI_TIMEOUT', timeout: 99000 })).toBe(99000);
  });

  it('ignores non-numeric / non-positive env values', () => {
    process.env.GEMINI_TIMEOUT = 'not-a-number';
    expect(resolveTimeout({ envVar: 'GEMINI_TIMEOUT' })).toBe(DEFAULT_ADAPTER_TIMEOUT_MS);
    process.env.GEMINI_TIMEOUT = '0';
    expect(resolveTimeout({ envVar: 'GEMINI_TIMEOUT' })).toBe(DEFAULT_ADAPTER_TIMEOUT_MS);
  });
});

describe('adapter timeout wiring', () => {
  beforeEach(clearTimeoutEnv);
  afterEach(clearTimeoutEnv);

  const key = 'test-key';

  it('GeminiAdapter defaults to 60s and honours GEMINI_TIMEOUT + constructor arg', () => {
    expect(new GeminiAdapter(key).timeout).toBe(60_000);

    process.env.GEMINI_TIMEOUT = '120000';
    expect(new GeminiAdapter(key).timeout).toBe(120_000);

    expect(new GeminiAdapter(key, 'gemini-flash-2.0', 90_000).timeout).toBe(90_000);
  });

  it('OpenAIAdapter defaults to 60s and honours OPENAI_TIMEOUT + constructor arg (4th param)', () => {
    expect(new OpenAIAdapter(key).timeout).toBe(60_000);

    process.env.OPENAI_TIMEOUT = '75000';
    expect(new OpenAIAdapter(key).timeout).toBe(75_000);

    expect(new OpenAIAdapter(key, 'gpt-4o-mini', undefined, 30_000).timeout).toBe(30_000);
  });

  it('AnthropicAdapter defaults to 60s and honours ANTHROPIC_TIMEOUT + constructor arg', () => {
    expect(new AnthropicAdapter(key).timeout).toBe(60_000);

    process.env.ANTHROPIC_TIMEOUT = '50000';
    expect(new AnthropicAdapter(key).timeout).toBe(50_000);

    expect(new AnthropicAdapter(key, 'claude-3-5-sonnet-20241022', 88_000).timeout).toBe(88_000);
  });

  it('OllamaAdapter defaults to 120s and honours OLLAMA_TIMEOUT + constructor arg (3rd param)', () => {
    expect(new OllamaAdapter('llama3.1').timeout).toBe(120_000);

    process.env.OLLAMA_TIMEOUT = '180000';
    expect(new OllamaAdapter('llama3.1').timeout).toBe(180_000);

    expect(new OllamaAdapter('llama3.1', undefined, 240_000).timeout).toBe(240_000);
  });

  it('every adapter falls back to BEE_TIMEOUT when its own env var is unset', () => {
    process.env.BEE_TIMEOUT = '95000';
    expect(new GeminiAdapter(key).timeout).toBe(95_000);
    expect(new OpenAIAdapter(key).timeout).toBe(95_000);
    expect(new AnthropicAdapter(key).timeout).toBe(95_000);
    expect(new OllamaAdapter('llama3.1').timeout).toBe(95_000);
  });
});

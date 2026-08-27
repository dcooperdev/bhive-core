import { LLMAdapter } from '../providers/LLMAdapter';
import { GeminiAdapter } from './adapters/GeminiAdapter';
import { OpenAIAdapter } from './adapters/OpenAIAdapter';
import { AnthropicAdapter } from './adapters/AnthropicAdapter';
import { OllamaAdapter } from './adapters/OllamaAdapter';

export type LLMProviderName = 'gemini' | 'openai' | 'anthropic' | 'ollama';

export interface ProviderDescriptor {
  name: LLMProviderName;
  defaultModel: string;
  /** Env var read by that provider's adapter when no apiKey is passed explicitly. null = no key needed (Ollama). */
  envVar: string | null;
  toolCalling: 'full' | 'basic';
  create: (apiKey: string | undefined, model: string, timeout?: number) => LLMAdapter;
}

/** Single source of truth for "what providers exist" - see docs/LLM_PROVIDERS.md for the same table in prose. */
export const PROVIDER_REGISTRY: Record<LLMProviderName, ProviderDescriptor> = {
  gemini: {
    name: 'gemini',
    defaultModel: 'gemini-flash-2.0',
    envVar: 'GOOGLE_API_KEY',
    toolCalling: 'full',
    create: (apiKey, model, timeout) => new GeminiAdapter(apiKey, model, timeout)
  },
  openai: {
    name: 'openai',
    defaultModel: 'gpt-4o-mini',
    envVar: 'OPENAI_API_KEY',
    toolCalling: 'full',
    create: (apiKey, model, timeout) => new OpenAIAdapter(apiKey, model, undefined, timeout)
  },
  anthropic: {
    name: 'anthropic',
    defaultModel: 'claude-3-5-sonnet-20241022',
    envVar: 'ANTHROPIC_API_KEY',
    toolCalling: 'full',
    create: (apiKey, model, timeout) => new AnthropicAdapter(apiKey, model, timeout)
  },
  ollama: {
    name: 'ollama',
    defaultModel: 'llama3.1',
    envVar: null,
    toolCalling: 'basic',
    create: (_apiKey, model, timeout) => new OllamaAdapter(model, undefined, timeout)
  }
};

export function isKnownProvider(name: string): name is LLMProviderName {
  return name in PROVIDER_REGISTRY;
}

/**
 * Builds the adapter for `provider`, defaulting the model from the registry
 * when `model` is omitted. An explicit `timeout` (ms) overrides the adapter's
 * env-var / default resolution; omit it to let the adapter resolve its own.
 */
export function createLLMAdapter(
  provider: LLMProviderName,
  apiKey?: string,
  model?: string,
  timeout?: number
): LLMAdapter {
  const descriptor = PROVIDER_REGISTRY[provider];
  if (!descriptor) {
    throw new Error(`Unknown LLM provider "${provider}". Supported providers: ${Object.keys(PROVIDER_REGISTRY).join(', ')}`);
  }
  return descriptor.create(apiKey, model ?? descriptor.defaultModel, timeout);
}

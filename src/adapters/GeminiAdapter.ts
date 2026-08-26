import { SimpleLLM } from '../llm/SimpleLLM';
import { LLMAdapter } from '../providers/LLMAdapter';

/**
 * GeminiAdapter - LLMAdapter implementation backed by SimpleLLM, Hive's
 * raw HTTP client for the Google Gemini API.
 *
 * This is the default adapter BeeManager falls back to when no other
 * LLMAdapter is injected.
 */
export class GeminiAdapter extends SimpleLLM implements LLMAdapter {
  readonly name = 'gemini';
}

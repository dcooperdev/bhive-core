import { Tool, ToolParameterSchema } from '../../types';

const EMPTY_SCHEMA: ToolParameterSchema = { type: 'object', properties: {} };

/**
 * Converts our generic Tool[] into OpenAI's `tools` shape (Chat Completions
 * function-calling format). Also used as-is by OllamaAdapter, since Ollama's
 * /api/chat tool schema mirrors OpenAI's.
 */
export function toOpenAITools(tools: Tool[]) {
  return tools.map(tool => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters ?? EMPTY_SCHEMA
    }
  }));
}

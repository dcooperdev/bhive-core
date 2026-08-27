import { Tool, ToolParameterSchema } from '../../types';

const EMPTY_SCHEMA: ToolParameterSchema = { type: 'object', properties: {} };

/** Converts our generic Tool[] into Anthropic's Messages API `tools` shape (`input_schema`). */
export function toAnthropicTools(tools: Tool[]) {
  return tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters ?? EMPTY_SCHEMA
  }));
}

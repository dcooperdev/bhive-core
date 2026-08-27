import { Tool, ToolParameterSchema } from '../../types';

const EMPTY_SCHEMA: ToolParameterSchema = { type: 'object', properties: {} };

/** Converts our generic Tool[] into Gemini's `functionDeclarations` shape (uppercase JSON-schema types). */
export function toGeminiFunctionDeclarations(tools: Tool[]) {
  return tools.map(tool => {
    const schema = tool.parameters ?? EMPTY_SCHEMA;
    return {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'OBJECT',
        properties: Object.fromEntries(
          Object.entries(schema.properties).map(([key, value]) => [
            key,
            { type: value.type.toUpperCase(), description: value.description, ...(value.enum ? { enum: value.enum } : {}) }
          ])
        ),
        required: schema.required ?? []
      }
    };
  });
}

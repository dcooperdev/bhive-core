import { ToolCallingParser } from '../../src/llm/ToolCallingParser';

describe('ToolCallingParser', () => {
  it('parses Gemini functionCall parts', () => {
    const response = {
      candidates: [
        {
          content: {
            parts: [{ functionCall: { name: 'fetch_repo', args: { repo: 'anthropics/claude-code' } } }]
          }
        }
      ]
    };
    const calls = ToolCallingParser.parseFunctionCalls(response, 'gemini');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ name: 'fetch_repo', args: { repo: 'anthropics/claude-code' } });
    expect(calls[0].id).toBeTruthy();
  });

  it('returns [] for a Gemini response with only a text part', () => {
    const response = { candidates: [{ content: { parts: [{ text: 'hello' }] } }] };
    expect(ToolCallingParser.parseFunctionCalls(response, 'gemini')).toEqual([]);
  });

  it('parses OpenAI tool_calls with stringified JSON arguments', () => {
    const response = {
      choices: [
        {
          message: {
            tool_calls: [{ id: 'call_1', function: { name: 'analyze_code', arguments: '{"complexity":"low"}' } }]
          }
        }
      ]
    };
    const calls = ToolCallingParser.parseFunctionCalls(response, 'openai');
    expect(calls).toEqual([{ id: 'call_1', name: 'analyze_code', args: { complexity: 'low' } }]);
  });

  it('parses legacy OpenAI function_call (pre tool_calls API)', () => {
    const response = { choices: [{ message: { function_call: { name: 'legacy_tool', arguments: '{"x":1}' } } }] };
    const calls = ToolCallingParser.parseFunctionCalls(response, 'openai');
    expect(calls).toEqual([{ id: 'openai-legacy-0', name: 'legacy_tool', args: { x: 1 } }]);
  });

  it('degrades malformed OpenAI arguments JSON to {} instead of throwing', () => {
    const response = { choices: [{ message: { tool_calls: [{ id: 'call_1', function: { name: 'broken', arguments: '{not json' } }] } }] };
    const calls = ToolCallingParser.parseFunctionCalls(response, 'openai');
    expect(calls).toEqual([{ id: 'call_1', name: 'broken', args: {} }]);
  });

  it('parses Anthropic tool_use content blocks and ignores text blocks', () => {
    const response = {
      type: 'message',
      content: [
        { type: 'text', text: 'Let me check that.' },
        { type: 'tool_use', id: 'toolu_1', name: 'generate_report', input: { format: 'json' } }
      ]
    };
    const calls = ToolCallingParser.parseFunctionCalls(response, 'anthropic');
    expect(calls).toEqual([{ id: 'toolu_1', name: 'generate_report', args: { format: 'json' } }]);
  });

  it('parses Ollama OpenAI-shaped tool_calls', () => {
    const response = { message: { role: 'assistant', tool_calls: [{ function: { name: 'fetch_repo', arguments: { repo: 'x/y' } } }] } };
    const calls = ToolCallingParser.parseFunctionCalls(response, 'ollama');
    expect(calls).toEqual([{ id: 'ollama-0', name: 'fetch_repo', args: { repo: 'x/y' } }]);
  });

  it('auto-detects the provider shape when hint is "auto"', () => {
    const openaiResponse = { choices: [{ message: { tool_calls: [{ id: 'c1', function: { name: 't', arguments: '{}' } }] } }] };
    expect(ToolCallingParser.parseFunctionCalls(openaiResponse, 'auto')).toHaveLength(1);
  });

  it('returns [] for null, non-object, or unrecognized responses', () => {
    expect(ToolCallingParser.parseFunctionCalls(null)).toEqual([]);
    expect(ToolCallingParser.parseFunctionCalls('a string')).toEqual([]);
    expect(ToolCallingParser.parseFunctionCalls({ nothing: 'recognizable' })).toEqual([]);
  });

  it('filters out Ollama tool_calls missing a function name', () => {
    const response = { message: { tool_calls: [{ function: { arguments: {} } }] } };
    expect(ToolCallingParser.parseFunctionCalls(response, 'ollama')).toEqual([]);
  });
});

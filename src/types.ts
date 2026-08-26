export interface Tool {
  name: string;
  description: string;
  execute: (params: any) => Promise<string>;
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export interface ToolCall {
  toolName: string;
  params: any;
  result: string;
}

export interface AgentRun {
  agent: string;
  input: string;
  toolCalls: ToolCall[];
  output: string;
  tokensUsed: number;
  timestamp: Date;
}

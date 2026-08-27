import axios from 'axios';
import dotenv from 'dotenv';
import { Message, Tool } from '../types';

dotenv.config();

export class SimpleLLM {
  private apiKey: string;
  private model: string;
  private baseURL: string;
  public totalTokens = 0;
  private callCount = 0;

  constructor(apiKey?: string, model: string = 'gemini-3.6-flash') {
    this.apiKey = apiKey || process.env.GOOGLE_API_KEY || '';
    this.model = model;

    if (!this.apiKey) {
      throw new Error(
        'GOOGLE_API_KEY not set. Add it to .env file\nGet free key at https://aistudio.google.com/app/apikey'
      );
    }

    this.baseURL = 'https://generativelanguage.googleapis.com/v1beta/models';
  }

  async complete(
    messages: Message[],
    tools?: Tool[]
  ): Promise<{ content: string; toolCalls: any[] }> {
    this.callCount++;

    try {
      const response = await axios.post(
        `${this.baseURL}/${this.model}:generateContent`,
        {
          contents: messages.map(m => ({
            role: m.role === 'user' ? 'user' : 'model',
            parts: [{ text: m.content }]
          }))
        },
        {
          headers: {
            'Content-Type': 'application/json'
          },
          params: {
            key: this.apiKey  // API key va acá, no en la URL hardcodeada
          }
        }
      );

      const content = response.data.candidates[0].content.parts[0].text;
      const tokens = response.data.usageMetadata?.totalTokenCount || 0;

      this.totalTokens += tokens;

      console.log(`   💰 Tokens: ${tokens} (Total: ${this.totalTokens})`);

      return {
        content: content,
        toolCalls: []
      };
    } catch (error) {
      console.error('❌ LLM Error:', (error as Error).message);
      throw error;
    }
  }

  setModel(model: string): void {
    this.model = model;
  }

  getModel(): string {
    return this.model;
  }

  getTokens(): number {
    return this.totalTokens;
  }

  getCallCount(): number {
    return this.callCount;
  }

  resetStats(): void {
    this.totalTokens = 0;
    this.callCount = 0;
  }
}

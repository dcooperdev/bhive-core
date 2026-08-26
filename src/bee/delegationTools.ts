import { Tool, ToolExecutionContext } from '../types';

/**
 * Creates a Tool that delegates its task to another registered agent.
 *
 * Attach the returned Tool to a Bee created via BeeManager.createBee() —
 * it needs the ToolExecutionContext Bee.executeWithRateLimit() passes to
 * every tool call, which only exists for Bees wired to a BeeManager.
 *
 * @example
 * beeManager.createBee({
 *   name: 'classifier',
 *   prompt: 'Classify the email, then delegate drafting a reply to the responder agent.',
 *   tools: [classifyTool, createDelegationTool('responder', 'Delegate email response')]
 * });
 */
export function createDelegationTool(agentName: string, description?: string): Tool {
  return {
    name: `delegate_to_${agentName}`,
    description: description || `Delegate a task to the "${agentName}" agent`,
    execute: async (params: { task: string }, context?: ToolExecutionContext): Promise<string> => {
      if (!context?.delegate) {
        throw new Error(
          `delegate_to_${agentName} requires a Bee execution context; attach this tool to a Bee created via BeeManager.createBee()`
        );
      }

      return context.delegate(agentName, params.task);
    }
  };
}

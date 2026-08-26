import { createDelegationTool } from '../../src/bee/delegationTools';

describe('createDelegationTool', () => {
  it('should name and describe the tool after the target agent', () => {
    const tool = createDelegationTool('responder');

    expect(tool.name).toBe('delegate_to_responder');
    expect(tool.description).toMatch(/responder/);
  });

  it('should use a custom description when given', () => {
    const tool = createDelegationTool('responder', 'Delegate email response');
    expect(tool.description).toBe('Delegate email response');
  });

  it('should call context.delegate with the agent name and task', async () => {
    const delegate = jest.fn().mockResolvedValue('done');
    const tool = createDelegationTool('responder');

    const result = await tool.execute({ task: 'Draft a reply' }, { beeName: 'classifier', delegate });

    expect(delegate).toHaveBeenCalledWith('responder', 'Draft a reply');
    expect(result).toBe('done');
  });

  it('should throw a clear error when no execution context is given', async () => {
    const tool = createDelegationTool('responder');

    await expect(tool.execute({ task: 'Draft a reply' })).rejects.toThrow(
      /requires a Bee execution context/
    );
  });
});

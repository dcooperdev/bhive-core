jest.mock('axios');

import { BeeManager } from '../../src/bee/BeeManager';
import { createDelegationTool } from '../../src/bee/delegationTools';
import { BeeSecurityContext } from '../../src/bee/BeeSecurityContext';
import { MockLLM } from '../__mocks__/MockLLM';
import { RecordingEventPublisher } from '../fixtures/providers';
import { mockLabelTool } from '../fixtures/tools';

function setUpTwoAgentHive(events?: RecordingEventPublisher) {
  const beeManager = new BeeManager('gemini-1.5-flash', {
    apiKey: 'test-api-key',
    eventPublisher: events
  });

  const classifierLLM = new MockLLM();
  const responderLLM = new MockLLM();

  beeManager.createBee({
    name: 'classifier',
    prompt: 'Classify the email',
    tools: [createDelegationTool('responder')],
    llmAdapter: classifierLLM
  });

  beeManager.createBee({
    name: 'responder',
    prompt: 'Draft a response',
    tools: [],
    llmAdapter: responderLLM
  });

  // The default mock response only kicks in for prompts containing the
  // exact substring "respond" - script an explicit, deterministic reply
  // instead of relying on that coincidence.
  responderLLM.respondOnceWith({ content: 'Here is a professional response...', toolCalls: [] });

  return { beeManager, classifierLLM, responderLLM };
}

describe('Agent-to-agent delegation', () => {
  describe('Bee.delegateTo()', () => {
    it('should call the correct target agent and resolve with its output', async () => {
      const { beeManager } = setUpTwoAgentHive();
      const classifier = beeManager.getBee('classifier')!;

      const result = await classifier.delegateTo('responder', 'Draft a reply');

      expect(result).toBe('Here is a professional response...');
      expect(beeManager.getBee('responder')!.getRuns()).toHaveLength(1);
      expect(beeManager.getBee('responder')!.getRuns()[0].input).toBe('Draft a reply');
    });

    it('should throw when the Bee was not created via BeeManager', async () => {
      const { Bee } = await import('../../src/bee/Bee');
      const { BeeConfig } = await import('../../src/bee/BeeConfig');
      const orphan = new Bee('orphan', 'Test', [], new MockLLM(), new BeeConfig(), 'gemini-1.5-flash');

      await expect(orphan.delegateTo('anyone', 'task')).rejects.toThrow(
        /not created via BeeManager\.createBee/
      );
    });

    it('should expose sibling agents via getAvailableAgents()', () => {
      const { beeManager } = setUpTwoAgentHive();
      const classifier = beeManager.getBee('classifier')!;

      expect(classifier.getAvailableAgents()).toEqual(['responder']);
      // A Bee never lists itself as an available delegate.
      expect(classifier.getAvailableAgents()).not.toContain('classifier');
    });

    it('should return an empty agent list for a Bee with no BeeManager', async () => {
      const { Bee } = await import('../../src/bee/Bee');
      const { BeeConfig } = await import('../../src/bee/BeeConfig');
      const orphan = new Bee('orphan', 'Test', [], new MockLLM(), new BeeConfig(), 'gemini-1.5-flash');

      expect(orphan.getAvailableAgents()).toEqual([]);
    });
  });

  describe('BeeManager.delegateToAgent()', () => {
    it('should resolve the delegated task through the target Bee', async () => {
      const { beeManager } = setUpTwoAgentHive();

      const result = await beeManager.delegateToAgent('classifier', 'responder', 'Draft a reply');

      expect(result).toBe('Here is a professional response...');
    });

    it('should throw when the target agent is not registered', async () => {
      const { beeManager } = setUpTwoAgentHive();

      await expect(
        beeManager.delegateToAgent('classifier', 'nonexistent', 'task')
      ).rejects.toThrow(/agent "nonexistent" is not registered/);
    });

    it('should record every attempt in getDelegationHistory()', async () => {
      const { beeManager } = setUpTwoAgentHive();

      await beeManager.delegateToAgent('classifier', 'responder', 'Draft a reply');

      const history = beeManager.getDelegationHistory();
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ from: 'classifier', to: 'responder', task: 'Draft a reply' });
    });

    it('should emit delegation:error and rethrow when the target Bee itself rejects', async () => {
      const events = new RecordingEventPublisher();
      const beeManager = new BeeManager('gemini-1.5-flash', { apiKey: 'test-api-key', eventPublisher: events });

      beeManager.createBee({ name: 'classifier', prompt: 'Classify', tools: [], llmAdapter: new MockLLM() });
      // A bee whose queue is already full: its own run() rejects immediately.
      beeManager.createBee({
        name: 'responder',
        prompt: 'Respond',
        tools: [],
        llmAdapter: new MockLLM(),
        queueConfig: { maxSize: 0 }
      });

      await expect(
        beeManager.delegateToAgent('classifier', 'responder', 'Draft a reply')
      ).rejects.toThrow(/Queue full/);

      expect(events.eventsOfType('delegation:error')).toHaveLength(1);
      expect(events.eventsOfType('delegation:error')[0].data.error).toMatch(/Queue full/);
    });

    it('should log and continue when the event publisher itself throws', async () => {
      const throwingPublisher = { name: 'broken', publish: async () => { throw new Error('publish failed'); } };
      const beeManager = new BeeManager('gemini-1.5-flash', {
        apiKey: 'test-api-key',
        eventPublisher: throwingPublisher
      });
      beeManager.createBee({ name: 'classifier', prompt: 'Classify', tools: [], llmAdapter: new MockLLM() });
      beeManager.createBee({ name: 'responder', prompt: 'Respond', tools: [], llmAdapter: new MockLLM() });

      await expect(
        beeManager.delegateToAgent('classifier', 'responder', 'Draft a reply')
      ).resolves.toBeDefined();
    });
  });

  describe('circular delegation detection', () => {
    it('should reject when the target is already in the delegation chain', async () => {
      const { beeManager } = setUpTwoAgentHive();

      await expect(
        beeManager.delegateToAgent('classifier', 'responder', 'task', ['classifier', 'responder'])
      ).rejects.toThrow(/Circular delegation detected/);
    });

    it('should reject a direct A → B → A cycle at the Bee level', async () => {
      const beeManager = new BeeManager('gemini-1.5-flash', { apiKey: 'test-api-key' });
      beeManager.createBee({ name: 'a', prompt: 'A', tools: [], llmAdapter: new MockLLM() });
      beeManager.createBee({ name: 'b', prompt: 'B', tools: [], llmAdapter: new MockLLM() });
      const beeA = beeManager.getBee('a')!;

      // Chain already contains 'b' - as if A had already been reached via B once before.
      await expect(beeA.delegateTo('b', 'task', ['a', 'b'])).rejects.toThrow(/Circular delegation detected/);
    });

    it('should not crash the delegating Bee when a nested delegation is circular', async () => {
      const events = new RecordingEventPublisher();
      const beeManager = new BeeManager('gemini-1.5-flash', { apiKey: 'test-api-key', eventPublisher: events });

      const aLLM = new MockLLM();
      const bLLM = new MockLLM();

      beeManager.createBee({
        name: 'a',
        prompt: 'Agent A',
        tools: [createDelegationTool('b')],
        llmAdapter: aLLM
      });
      beeManager.createBee({
        name: 'b',
        prompt: 'Agent B',
        tools: [createDelegationTool('a')],
        llmAdapter: bLLM
      });

      aLLM.respondOnceWith({
        content: 'Delegating to B',
        toolCalls: [{ name: 'delegate_to_b', params: { task: 'do work' } }]
      });
      aLLM.respondOnceWith({ content: 'Finished after B', toolCalls: [] });

      // B immediately tries to delegate straight back to A - a cycle.
      bLLM.respondOnceWith({
        content: 'Delegating back to A',
        toolCalls: [{ name: 'delegate_to_a', params: { task: 'loop back' } }]
      });
      bLLM.respondOnceWith({ content: 'B finished', toolCalls: [] });

      const beeA = beeManager.getBee('a')!;
      const result = await beeA.run('start');

      // The whole chain still resolves - the circular attempt is caught
      // and logged as a failed tool call, not a crash.
      expect(result).toBe('Finished after B');
      expect(events.eventsOfType('delegation:error')).toHaveLength(1);
      expect(events.eventsOfType('delegation:error')[0].data.error).toMatch(/Circular delegation detected/);
    });
  });

  describe('trust levels', () => {
    it('should block delegation entirely for a "strict" Bee', async () => {
      const beeManager = new BeeManager('gemini-1.5-flash', { apiKey: 'test-api-key' });
      beeManager.createBee({ name: 'responder', prompt: 'Respond', tools: [] });
      beeManager.createBee({
        name: 'classifier',
        prompt: 'Classify',
        tools: [],
        llmAdapter: new MockLLM(),
        trustLevel: 'strict'
      });

      const classifier = beeManager.getBee('classifier')!;
      await expect(classifier.delegateTo('responder', 'task')).rejects.toThrow(/trustLevel "strict"/);
    });

    it('should only allow a "careful" Bee to delegate to its whitelist', async () => {
      const beeManager = new BeeManager('gemini-1.5-flash', { apiKey: 'test-api-key' });
      beeManager.createBee({ name: 'responder', prompt: 'Respond', tools: [], llmAdapter: new MockLLM() });
      beeManager.createBee({ name: 'auditor', prompt: 'Audit', tools: [], llmAdapter: new MockLLM() });
      beeManager.createBee({
        name: 'classifier',
        prompt: 'Classify',
        tools: [],
        llmAdapter: new MockLLM(),
        trustLevel: 'careful',
        allowedDelegates: ['responder']
      });

      const classifier = beeManager.getBee('classifier')!;

      await expect(classifier.delegateTo('responder', 'task')).resolves.toBeDefined();
      await expect(classifier.delegateTo('auditor', 'task')).rejects.toThrow(/not allowed to delegate/);
    });

    it('should default to "open" trust when none is configured', async () => {
      const { beeManager } = setUpTwoAgentHive();
      const classifier = beeManager.getBee('classifier')!;

      await expect(classifier.delegateTo('responder', 'task')).resolves.toBeDefined();
    });
  });

  describe('events', () => {
    it('should emit delegation:start and delegation:complete with from/to/task', async () => {
      const events = new RecordingEventPublisher();
      const { beeManager } = setUpTwoAgentHive(events);

      await beeManager.delegateToAgent('classifier', 'responder', 'Draft a reply');

      expect(events.eventsOfType('delegation:start')).toHaveLength(1);
      expect(events.eventsOfType('delegation:complete')).toHaveLength(1);
      expect(events.eventsOfType('delegation:start')[0].data).toMatchObject({
        from: 'classifier',
        to: 'responder',
        task: 'Draft a reply'
      });
      expect(events.eventsOfType('delegation:start')[0].beeName).toBe('classifier');
    });

    it('should emit delegation:error (not delegation:start/complete) when the target agent is missing', async () => {
      const events = new RecordingEventPublisher();
      const { beeManager } = setUpTwoAgentHive(events);

      await expect(beeManager.delegateToAgent('classifier', 'nonexistent', 'task')).rejects.toThrow();

      // The target doesn't exist, so delegation never actually starts, but
      // the failure is still observable as a delegation:error event.
      expect(events.eventsOfType('delegation:start')).toHaveLength(0);
      expect(events.eventsOfType('delegation:complete')).toHaveLength(0);
      expect(events.eventsOfType('delegation:error')).toHaveLength(1);
    });

    it("should also emit the target Bee's own run lifecycle events alongside delegation events", async () => {
      const events = new RecordingEventPublisher();
      const { beeManager } = setUpTwoAgentHive(events);

      await beeManager.delegateToAgent('classifier', 'responder', 'Draft a reply');

      const responderRunEvents = events.events.filter(e => e.beeName === 'responder');
      expect(responderRunEvents.map(e => e.type)).toEqual(
        expect.arrayContaining(['run:enqueued', 'run:start', 'run:complete'])
      );
    });
  });

  describe('Integration: Email Manager Hive with delegation (Classifier → Responder → Executor)', () => {
    it('should run the full chain through tool-based delegation', async () => {
      const events = new RecordingEventPublisher();
      const beeManager = new BeeManager('gemini-1.5-flash', {
        apiKey: 'test-api-key',
        eventPublisher: events
      });

      const classifierLLM = new MockLLM();
      const responderLLM = new MockLLM();
      const executorLLM = new MockLLM();

      beeManager.createBee({
        name: 'classifier',
        prompt: 'Classify the email and delegate the response',
        tools: [createDelegationTool('responder', 'Delegate email response')],
        llmAdapter: classifierLLM
      });

      beeManager.createBee({
        name: 'responder',
        prompt: 'Draft a response and delegate execution',
        tools: [createDelegationTool('executor', 'Delegate applying the outcome')],
        llmAdapter: responderLLM
      });

      beeManager.createBee({
        name: 'executor',
        prompt: 'Apply the final label',
        tools: [mockLabelTool],
        llmAdapter: executorLLM
      });

      classifierLLM.respondOnceWith({
        content: 'Classified as VIP, delegating response',
        toolCalls: [{ name: 'delegate_to_responder', params: { task: 'Draft a VIP reply' } }]
      });
      classifierLLM.respondOnceWith({ content: 'Classifier done', toolCalls: [] });

      responderLLM.respondOnceWith({
        content: 'Draft ready, delegating execution',
        toolCalls: [{ name: 'delegate_to_executor', params: { task: 'Apply VIP label' } }]
      });
      responderLLM.respondOnceWith({ content: 'Responder done', toolCalls: [] });

      executorLLM.respondOnceWith({ content: 'Label applied', toolCalls: [] });

      const result = await beeManager.executeTask('Process VIP email', ['classifier']);

      expect(result.classifier).toBe('Classifier done');
      expect(beeManager.getBee('responder')!.getRuns()).toHaveLength(1);
      expect(beeManager.getBee('executor')!.getRuns()).toHaveLength(1);
      expect(beeManager.getBee('executor')!.getRuns()[0].input).toBe('Apply VIP label');

      const delegations = beeManager.getDelegationHistory();
      expect(delegations.map(d => `${d.from}->${d.to}`)).toEqual(['classifier->responder', 'responder->executor']);
    });
  });

  describe('secure delegation (v0.4)', () => {
    it('should still work when fromBeeName does not correspond to a registered Bee (default open context, fresh identity)', async () => {
      const beeManager = new BeeManager('gemini-1.5-flash', {
        apiKey: 'test-api-key',
        securityOptions: { enableSigning: true }
      });
      beeManager.createBee({ name: 'responder', prompt: 'Respond', tools: [], llmAdapter: new MockLLM() });

      // "system" is not a Bee this manager created - delegateToAgent still
      // works, falling back to a permissive context and generating a
      // fresh identity for it on demand.
      const result = await beeManager.delegateToAgent('system', 'responder', 'Kick off the workflow');

      expect(result).toBeDefined();
      expect(beeManager.getIdentityManager().hasIdentity('system')).toBe(true);
    });

    it('should emit delegation:security_error and record rate_limit_exceeded once the sender exceeds its rate limit', async () => {
      const events = new RecordingEventPublisher();
      const beeManager = new BeeManager('gemini-1.5-flash', { apiKey: 'test-api-key', eventPublisher: events });

      beeManager.createBee({
        name: 'classifier',
        prompt: 'Classify',
        tools: [],
        llmAdapter: new MockLLM(),
        securityContext: new BeeSecurityContext({ maxMessagesPerMinute: 1 })
      });
      beeManager.createBee({ name: 'responder', prompt: 'Respond', tools: [], llmAdapter: new MockLLM() });

      await beeManager.delegateToAgent('classifier', 'responder', 'first');
      await expect(beeManager.delegateToAgent('classifier', 'responder', 'second')).rejects.toThrow(
        /exceeded its rate limit/
      );

      const securityErrors = events.eventsOfType('delegation:security_error');
      expect(securityErrors.some(e => (e.data as any).reason === 'rate_limit')).toBe(true);

      const entries = await beeManager.getAuditLog().getEntriesByType('rate_limit_exceeded');
      expect(entries.length).toBeGreaterThan(0);
    });

    it('should emit delegation:security_error and record signature_failed when the pipeline itself hits a security failure', async () => {
      const events = new RecordingEventPublisher();
      const beeManager = new BeeManager('gemini-1.5-flash', {
        apiKey: 'test-api-key',
        eventPublisher: events,
        securityOptions: { enableEncryption: true }
      });

      beeManager.createBee({ name: 'classifier', prompt: 'Classify', tools: [], llmAdapter: new MockLLM() });
      beeManager.createBee({ name: 'responder', prompt: 'Respond', tools: [], llmAdapter: new MockLLM() });

      // Corrupt responder's identity so its public/private keys no longer
      // match - decryption fails even though everything else is normal.
      const identityManager = beeManager.getIdentityManager();
      const responderIdentity = identityManager.getBeeIdentity('responder')!;
      const otherIdentity = identityManager.registerBeeIdentity('unrelated-bee');
      identityManager.loadIdentity({ ...responderIdentity, privateKey: otherIdentity.privateKey });

      await expect(beeManager.delegateToAgent('classifier', 'responder', 'Draft a reply')).rejects.toThrow(
        /Decryption failed/
      );

      expect(events.eventsOfType('delegation:security_error')).toHaveLength(1);
      const failures = await beeManager.getAuditLog().getEntriesByType('signature_failed');
      expect(failures.length).toBeGreaterThan(0);
    });

    describe('verifyIncomingMessage', () => {
      it('should throw when the recipient has no registered identity', () => {
        const beeManager = new BeeManager('gemini-1.5-flash', { apiKey: 'test-api-key' });
        const message = {
          id: '1',
          from: 'a',
          to: 'unregistered',
          timestamp: Date.now(),
          data: 'ciphertext',
          encrypted: true,
          iv: 'x',
          authTag: 'y',
          encryptedKey: 'z'
        };

        expect(() => beeManager.verifyIncomingMessage(message, 'a', 'unregistered')).toThrow(
          /No identity registered for recipient/
        );
      });

      it('should throw when the sender has no registered identity', () => {
        const beeManager = new BeeManager('gemini-1.5-flash', { apiKey: 'test-api-key' });
        beeManager.createBee({ name: 'responder', prompt: 'Respond', tools: [], llmAdapter: new MockLLM() });

        const message = {
          id: '1',
          from: 'unregistered-sender',
          to: 'responder',
          timestamp: Date.now(),
          data: 'plain data',
          signature: 'abc',
          nonce: 'xyz'
        };

        expect(() => beeManager.verifyIncomingMessage(message, 'unregistered-sender', 'responder')).toThrow(
          /No identity registered for sender/
        );
      });

      it('should throw when the signature does not verify', () => {
        const beeManager = new BeeManager('gemini-1.5-flash', {
          apiKey: 'test-api-key',
          securityOptions: { enableSigning: true }
        });
        beeManager.createBee({ name: 'classifier', prompt: 'Classify', tools: [], llmAdapter: new MockLLM() });
        beeManager.createBee({ name: 'responder', prompt: 'Respond', tools: [], llmAdapter: new MockLLM() });

        const message = {
          id: '1',
          from: 'classifier',
          to: 'responder',
          timestamp: Date.now(),
          data: 'task',
          signature: '00'.repeat(32),
          nonce: 'a-fresh-nonce'
        };

        expect(() => beeManager.verifyIncomingMessage(message, 'classifier', 'responder')).toThrow(
          /Message verification failed/
        );
      });
    });
  });
});

import { BeeSecurityContext } from '../../src/bee/BeeSecurityContext';

describe('BeeSecurityContext', () => {
  describe('defaults', () => {
    it('should default to fully permissive "open" trust', () => {
      const ctx = new BeeSecurityContext();

      expect(ctx.trustLevel).toBe('open');
      expect(ctx.isAllowedDelegate('anyone')).toBe(true);
      expect(ctx.isolated).toBe(false);
      expect(ctx.allowedDelegates).toEqual([]);
      expect(ctx.allowedTools).toEqual([]);
    });

    it('should default maxMessageSize to 1MB', () => {
      const ctx = new BeeSecurityContext();
      expect(ctx.maxMessageSize).toBe(1_000_000);
    });
  });

  describe('isAllowedDelegate', () => {
    it('should allow any delegate under "open" trust', () => {
      const ctx = new BeeSecurityContext({ trustLevel: 'open' });
      expect(ctx.isAllowedDelegate('responder')).toBe(true);
      expect(ctx.isAllowedDelegate('anyone-else')).toBe(true);
    });

    it('should only allow whitelisted delegates under "careful" trust', () => {
      const ctx = new BeeSecurityContext({ trustLevel: 'careful', allowedDelegates: ['responder'] });

      expect(ctx.isAllowedDelegate('responder')).toBe(true);
      expect(ctx.isAllowedDelegate('executor')).toBe(false);
    });

    it('should never allow delegation under "strict" trust', () => {
      const ctx = new BeeSecurityContext({ trustLevel: 'strict', allowedDelegates: ['responder'] });
      expect(ctx.isAllowedDelegate('responder')).toBe(false);
    });
  });

  describe('validateMessage', () => {
    it('should accept a message within the size limit', () => {
      const ctx = new BeeSecurityContext({ maxMessageSize: 1000 });
      expect(ctx.validateMessage({ data: 'small payload' })).toEqual({ valid: true });
    });

    it('should reject a message exceeding the size limit', () => {
      const ctx = new BeeSecurityContext({ maxMessageSize: 10 });
      const result = ctx.validateMessage({ data: 'a payload definitely longer than ten bytes' });

      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/exceeds maxMessageSize/);
    });

    it('should handle undefined data without throwing', () => {
      const ctx = new BeeSecurityContext();
      expect(ctx.validateMessage({ data: undefined })).toEqual({ valid: true });
    });
  });

  describe('checkRateLimit', () => {
    it('should allow messages under the configured limit', () => {
      const ctx = new BeeSecurityContext({ maxMessagesPerMinute: 3 });

      expect(ctx.checkRateLimit()).toBe(true);
      expect(ctx.checkRateLimit()).toBe(true);
      expect(ctx.checkRateLimit()).toBe(true);
    });

    it('should reject once the limit is reached within the window', () => {
      const ctx = new BeeSecurityContext({ maxMessagesPerMinute: 2 });

      expect(ctx.checkRateLimit()).toBe(true);
      expect(ctx.checkRateLimit()).toBe(true);
      expect(ctx.checkRateLimit()).toBe(false);
    });

    it('should allow messages again once old timestamps age out of the window', () => {
      const ctx = new BeeSecurityContext({ maxMessagesPerMinute: 1 });
      const realNow = Date.now;

      Date.now = jest.fn(() => 0);
      expect(ctx.checkRateLimit()).toBe(true);
      expect(ctx.checkRateLimit()).toBe(false);

      Date.now = jest.fn(() => 61_000); // 61s later, outside the 60s window
      expect(ctx.checkRateLimit()).toBe(true);

      Date.now = realNow;
    });
  });

  describe('isToolAllowed', () => {
    it('should allow any tool when allowedTools is empty', () => {
      const ctx = new BeeSecurityContext();
      expect(ctx.isToolAllowed('anything')).toBe(true);
    });

    it('should only allow whitelisted tools when allowedTools is set', () => {
      const ctx = new BeeSecurityContext({ allowedTools: ['classify_email'] });

      expect(ctx.isToolAllowed('classify_email')).toBe(true);
      expect(ctx.isToolAllowed('delete_everything')).toBe(false);
    });
  });
});

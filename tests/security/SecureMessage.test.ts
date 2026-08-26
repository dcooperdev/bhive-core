import { createSecureMessage, isSecureMessage, SecurityError } from '../../src/security/SecureMessage';

describe('createSecureMessage', () => {
  it('should build an unsigned, unencrypted envelope', () => {
    const message = createSecureMessage('classifier', 'responder', 'draft a reply');

    expect(message.from).toBe('classifier');
    expect(message.to).toBe('responder');
    expect(message.data).toBe('draft a reply');
    expect(message.id).toEqual(expect.any(String));
    expect(message.timestamp).toBeLessThanOrEqual(Date.now());
    expect(message.signature).toBeUndefined();
    expect(message.encrypted).toBeUndefined();
  });
});

describe('isSecureMessage', () => {
  it('should accept a well-formed message', () => {
    expect(isSecureMessage(createSecureMessage('a', 'b', 'task'))).toBe(true);
  });

  it('should reject null and non-objects', () => {
    expect(isSecureMessage(null)).toBe(false);
    expect(isSecureMessage('a string')).toBe(false);
    expect(isSecureMessage(42)).toBe(false);
  });

  it('should reject an object missing required fields', () => {
    expect(isSecureMessage({ id: '1', from: 'a' })).toBe(false);
  });

  it('should reject an object with the wrong field types', () => {
    expect(isSecureMessage({ id: '1', from: 'a', to: 'b', timestamp: 'not-a-number' })).toBe(false);
  });
});

describe('SecurityError', () => {
  it('should be a distinguishable Error subtype', () => {
    const error = new SecurityError('signature invalid');

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('SecurityError');
    expect(error.message).toBe('signature invalid');
  });
});

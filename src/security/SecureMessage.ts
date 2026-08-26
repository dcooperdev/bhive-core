import { randomUUID } from 'crypto';
import { SecureAgentMessage } from '../types';

export { SecureAgentMessage, SecurityConfig } from '../types';

/** Thrown for any failure in the decrypt/verify pipeline (as opposed to an ordinary delegation failure). */
export class SecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecurityError';
  }
}

/** Builds a fresh, unsigned, unencrypted envelope. Sign/encrypt it via MessageSigner/MessageEncryption before sending. */
export function createSecureMessage(from: string, to: string, data: unknown): SecureAgentMessage {
  return { id: randomUUID(), from, to, timestamp: Date.now(), data };
}

export function isSecureMessage(value: unknown): value is SecureAgentMessage {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SecureAgentMessage>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.from === 'string' &&
    typeof candidate.to === 'string' &&
    typeof candidate.timestamp === 'number'
  );
}

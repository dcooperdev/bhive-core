import { BeeKeyring } from '../../src/bee/BeeKeyring';
import { BeePublicIdentity } from '../../src/types';

describe('BeeKeyring', () => {
  let now: number;

  beforeEach(() => {
    now = Date.now();
    jest.spyOn(Date, 'now').mockImplementation(() => now);
  });

  afterEach(() => jest.restoreAllMocks());

  const create = (onRotate?: (identity: BeePublicIdentity) => void) =>
    new BeeKeyring('bee', { encryptionKeyRotationMs: 60_000, encryptionKeyRetentionMs: 10_000, onRotate });

  it('rotates the encryption key once the rotation interval has passed', () => {
    const onRotate = jest.fn();
    const keyring = create(onRotate);
    const first = keyring.getPublicIdentity().encryptionKeyId;

    now += 59_999;
    expect(keyring.getPublicIdentity().encryptionKeyId).toBe(first);
    expect(onRotate).not.toHaveBeenCalled();

    now += 1;
    const second = keyring.getPublicIdentity().encryptionKeyId;
    expect(second).not.toBe(first);
    expect(onRotate).toHaveBeenCalledWith(expect.objectContaining({ encryptionKeyId: second }));

    keyring.destroy();
  });

  it('keeps a replaced key for the retention window, then deletes it', () => {
    const keyring = create();
    const first = keyring.getPublicIdentity().encryptionKeyId;

    now += 60_000;
    keyring.maintain();
    expect(keyring.getHeldEncryptionKeyIds()).toContain(first);
    expect(keyring.getEncryptionPrivateKey(first)).toBeDefined();

    now += 10_000;
    expect(keyring.getEncryptionPrivateKey(first)).toBeUndefined();
    expect(keyring.getHeldEncryptionKeyIds()).not.toContain(first);

    keyring.destroy();
  });

  it('bounds the number of held keys regardless of how long it runs', () => {
    const keyring = create();

    for (let i = 0; i < 100; i++) {
      now += 60_000;
      keyring.maintain();
    }

    // Current key + at most the one still inside its retention window.
    expect(keyring.getHeldEncryptionKeyIds().length).toBeLessThanOrEqual(2);
    keyring.destroy();
  });

  it('supports an immediate manual rotation', () => {
    const keyring = create();
    const first = keyring.getPublicIdentity().encryptionKeyId;

    keyring.rotateEncryptionKey();

    expect(keyring.getPublicIdentity().encryptionKeyId).not.toBe(first);
    keyring.destroy();
  });

  it('keeps the signing key stable across encryption key rotations', () => {
    const keyring = create();
    const signingKey = keyring.getIdentity().signingPrivateKey;

    keyring.rotateEncryptionKey();

    expect(keyring.getIdentity().signingPrivateKey).toBe(signingKey);
    keyring.destroy();
  });

  it('exposes no private key material through enumeration or serialization', () => {
    const keyring = create();
    const serialized = JSON.stringify(keyring);

    expect(serialized).not.toContain(keyring.getIdentity().signingPrivateKey);
    expect(serialized).not.toContain(keyring.getIdentity().encryptionPrivateKey);
    expect(Object.keys(keyring).sort()).toEqual(['beeName', 'signingPublicKey', 'trustScore']);
    keyring.destroy();
  });

  it('deletes every encryption key on destroy()', () => {
    const keyring = create();
    keyring.destroy();

    expect(keyring.getHeldEncryptionKeyIds()).toEqual([]);
  });
});

import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  loadMTLSConfigFromFiles,
  loadMTLSConfigFromEnv,
  validateCertificateChain,
  toRedisTLSOptions,
  toEventBusTLSOptions,
  MTLSConfig
} from '../../src/security/mTLSConfig';

const FAKE_PEM = (label: string) => `-----BEGIN ${label}-----\nZmFrZS1jb250ZW50\n-----END ${label}-----\n`;

describe('mTLSConfig', () => {
  describe('loadMTLSConfigFromFiles', () => {
    it('should load ca/cert/key content from disk', () => {
      const dir = mkdtempSync(join(tmpdir(), 'hive-mtls-'));
      const caPath = join(dir, 'ca.pem');
      const certPath = join(dir, 'cert.pem');
      const keyPath = join(dir, 'key.pem');

      writeFileSync(caPath, FAKE_PEM('CERTIFICATE'));
      writeFileSync(certPath, FAKE_PEM('CERTIFICATE'));
      writeFileSync(keyPath, FAKE_PEM('PRIVATE KEY'));

      const config = loadMTLSConfigFromFiles({ ca: caPath, cert: certPath, key: keyPath });

      expect(config.ca).toContain('BEGIN CERTIFICATE');
      expect(config.key).toContain('BEGIN PRIVATE KEY');
      expect(config.rejectUnauthorized).toBe(true);
    });

    it('should honor an explicit rejectUnauthorized override', () => {
      const dir = mkdtempSync(join(tmpdir(), 'hive-mtls-'));
      const paths = { ca: join(dir, 'ca.pem'), cert: join(dir, 'cert.pem'), key: join(dir, 'key.pem') };
      writeFileSync(paths.ca, FAKE_PEM('CERTIFICATE'));
      writeFileSync(paths.cert, FAKE_PEM('CERTIFICATE'));
      writeFileSync(paths.key, FAKE_PEM('PRIVATE KEY'));

      const config = loadMTLSConfigFromFiles(paths, false);
      expect(config.rejectUnauthorized).toBe(false);
    });
  });

  describe('loadMTLSConfigFromEnv', () => {
    const ORIGINAL_ENV = process.env;

    beforeEach(() => {
      process.env = { ...ORIGINAL_ENV };
    });

    afterAll(() => {
      process.env = ORIGINAL_ENV;
    });

    it('should return undefined when credentials are missing', () => {
      delete process.env.HIVE_MTLS_CA;
      delete process.env.HIVE_MTLS_CERT;
      delete process.env.HIVE_MTLS_KEY;

      expect(loadMTLSConfigFromEnv()).toBeUndefined();
    });

    it('should load credentials when all three env vars are set', () => {
      process.env.HIVE_MTLS_CA = FAKE_PEM('CERTIFICATE');
      process.env.HIVE_MTLS_CERT = FAKE_PEM('CERTIFICATE');
      process.env.HIVE_MTLS_KEY = FAKE_PEM('PRIVATE KEY');

      const config = loadMTLSConfigFromEnv();
      expect(config?.ca).toContain('BEGIN CERTIFICATE');
      expect(config?.rejectUnauthorized).toBe(true);
    });

    it('should respect a custom prefix', () => {
      process.env.CUSTOM_MTLS_CA = FAKE_PEM('CERTIFICATE');
      process.env.CUSTOM_MTLS_CERT = FAKE_PEM('CERTIFICATE');
      process.env.CUSTOM_MTLS_KEY = FAKE_PEM('PRIVATE KEY');

      expect(loadMTLSConfigFromEnv('CUSTOM')).toBeDefined();
    });

    it('should set rejectUnauthorized to false only when explicitly "false"', () => {
      process.env.HIVE_MTLS_CA = FAKE_PEM('CERTIFICATE');
      process.env.HIVE_MTLS_CERT = FAKE_PEM('CERTIFICATE');
      process.env.HIVE_MTLS_KEY = FAKE_PEM('PRIVATE KEY');
      process.env.HIVE_MTLS_REJECT_UNAUTHORIZED = 'false';

      expect(loadMTLSConfigFromEnv()?.rejectUnauthorized).toBe(false);
    });
  });

  describe('validateCertificateChain', () => {
    it('should accept well-formed PEM content for all three credentials', () => {
      const config: MTLSConfig = {
        ca: FAKE_PEM('CERTIFICATE'),
        cert: FAKE_PEM('CERTIFICATE'),
        key: FAKE_PEM('PRIVATE KEY')
      };

      expect(validateCertificateChain(config)).toEqual({ valid: true });
    });

    it('should reject a malformed CA', () => {
      const config: MTLSConfig = { ca: 'not-pem', cert: FAKE_PEM('CERTIFICATE'), key: FAKE_PEM('PRIVATE KEY') };
      const result = validateCertificateChain(config);

      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/CA certificate/);
    });

    it('should reject a malformed client certificate', () => {
      const config: MTLSConfig = { ca: FAKE_PEM('CERTIFICATE'), cert: 'not-pem', key: FAKE_PEM('PRIVATE KEY') };
      const result = validateCertificateChain(config);

      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/Client certificate/);
    });

    it('should reject a malformed private key', () => {
      const config: MTLSConfig = { ca: FAKE_PEM('CERTIFICATE'), cert: FAKE_PEM('CERTIFICATE'), key: 'not-pem' };
      const result = validateCertificateChain(config);

      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/private key/);
    });
  });

  describe('toRedisTLSOptions / toEventBusTLSOptions', () => {
    it('should map an MTLSConfig to the ca/cert/key/rejectUnauthorized shape', () => {
      const config: MTLSConfig = {
        ca: FAKE_PEM('CERTIFICATE'),
        cert: FAKE_PEM('CERTIFICATE'),
        key: FAKE_PEM('PRIVATE KEY')
      };

      expect(toRedisTLSOptions(config)).toEqual({ ...config, rejectUnauthorized: true });
      expect(toEventBusTLSOptions(config)).toEqual({ ...config, rejectUnauthorized: true });
    });

    it('should preserve an explicit rejectUnauthorized: false', () => {
      const config: MTLSConfig = {
        ca: FAKE_PEM('CERTIFICATE'),
        cert: FAKE_PEM('CERTIFICATE'),
        key: FAKE_PEM('PRIVATE KEY'),
        rejectUnauthorized: false
      };

      expect(toRedisTLSOptions(config).rejectUnauthorized).toBe(false);
    });
  });
});

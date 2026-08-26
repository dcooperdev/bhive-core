import { readFileSync } from 'fs';

/**
 * mTLSConfig - mutual TLS credentials for a backend connection (Redis,
 * Kafka, a WebSocket EventBus, ...). Hive doesn't bundle any particular
 * client library; these helpers produce the PEM strings most Node TLS
 * clients (ioredis, kafkajs, ws, node:tls) accept directly as
 * `ca`/`cert`/`key`/`rejectUnauthorized` options.
 */
export interface MTLSConfig {
  /** PEM-encoded CA certificate content. */
  ca: string;
  /** PEM-encoded client certificate content. */
  cert: string;
  /** PEM-encoded client private key content. */
  key: string;
  /** Defaults to true - only disable for local development against a self-signed chain. */
  rejectUnauthorized?: boolean;
}

export interface CertificatePaths {
  ca: string;
  cert: string;
  key: string;
}

/** Loads mTLS credentials from PEM files on disk. */
export function loadMTLSConfigFromFiles(paths: CertificatePaths, rejectUnauthorized = true): MTLSConfig {
  return {
    ca: readFileSync(paths.ca, 'utf8'),
    cert: readFileSync(paths.cert, 'utf8'),
    key: readFileSync(paths.key, 'utf8'),
    rejectUnauthorized
  };
}

/**
 * Loads mTLS credentials from environment variables holding PEM content
 * directly (e.g. `${prefix}_MTLS_CA`). Returns undefined if any of the
 * three are missing, so callers can fall back to a non-mTLS connection.
 */
export function loadMTLSConfigFromEnv(prefix = 'HIVE'): MTLSConfig | undefined {
  const ca = process.env[`${prefix}_MTLS_CA`];
  const cert = process.env[`${prefix}_MTLS_CERT`];
  const key = process.env[`${prefix}_MTLS_KEY`];

  if (!ca || !cert || !key) return undefined;

  const rejectUnauthorizedEnv = process.env[`${prefix}_MTLS_REJECT_UNAUTHORIZED`];
  return { ca, cert, key, rejectUnauthorized: rejectUnauthorizedEnv !== 'false' };
}

/**
 * Structural validation of the PEM content (well-formed BEGIN/END
 * blocks). This does not perform full X.509 chain-of-trust
 * cryptographic verification - that happens at the TLS handshake layer
 * of whichever client (Redis/Kafka/etc.) actually opens the connection.
 */
export function validateCertificateChain(config: MTLSConfig): { valid: boolean; reason?: string } {
  const isPem = (value: string) => /-----BEGIN [^-]+-----[\s\S]+-----END [^-]+-----/.test(value.trim());

  if (!isPem(config.ca)) return { valid: false, reason: 'CA certificate is not valid PEM content' };
  if (!isPem(config.cert)) return { valid: false, reason: 'Client certificate is not valid PEM content' };
  if (!isPem(config.key)) return { valid: false, reason: 'Client private key is not valid PEM content' };

  return { valid: true };
}

/** Shape most Redis clients (e.g. ioredis' `tls` option) expect. */
export interface RedisTLSOptions {
  ca: string;
  cert: string;
  key: string;
  rejectUnauthorized?: boolean;
}

export function toRedisTLSOptions(config: MTLSConfig): RedisTLSOptions {
  return { ca: config.ca, cert: config.cert, key: config.key, rejectUnauthorized: config.rejectUnauthorized ?? true };
}

/** kafkajs' `ssl` option and a `ws`/`https` agent both accept this same shape. */
export function toEventBusTLSOptions(config: MTLSConfig): RedisTLSOptions {
  return toRedisTLSOptions(config);
}

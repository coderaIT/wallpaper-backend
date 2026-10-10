const SENSITIVE_KEY = /pass(word)?|secret|token|authorization|cookie|api[-_]?key|credential|hash|jwt/i;
const MAX_DEPTH = 5;
const MAX_STRING = 500;
const MAX_ARRAY = 50;

/**
 * Deep-copies audit metadata, replacing sensitive keys with "[REDACTED]" and bounding size,
 * so passwords, tokens and secrets can never be persisted in audit logs.
 */
export function sanitizeAuditMetadata(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (depth > MAX_DEPTH) return '[TRUNCATED]';
  if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY).map((v) => sanitizeAuditMetadata(v, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? '[REDACTED]' : sanitizeAuditMetadata(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

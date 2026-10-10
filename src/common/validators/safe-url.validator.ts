import { isIP } from 'node:net';
import { registerDecorator, ValidationOptions } from 'class-validator';

const PRIVATE_HOST_PATTERNS = [/^localhost$/i, /\.localhost$/i, /\.local$/i, /\.internal$/i];

function isPrivateIp(host: string): boolean {
  const version = isIP(host);
  if (version === 4) {
    const [a, b] = host.split('.').map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (version === 6) {
    const h = host.toLowerCase();
    return h === '::1' || h === '::' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80');
  }
  return false;
}

export interface SafeUrlOptions {
  /** Optional host allowlist (exact host or parent domain). Empty = any public host. */
  allowedHosts?: string[];
}

/**
 * Returns null if the URL is a safe, absolute https URL pointing to a public host,
 * otherwise a reason. Rejects javascript:/data:/file: schemes, embedded credentials,
 * IP literals in private ranges and local hostnames.
 */
export function checkSafeExternalUrl(value: unknown, options: SafeUrlOptions = {}): string | null {
  if (typeof value !== 'string' || value.length === 0) return 'must be a non-empty string';
  if (value.length > 2048) return 'must be at most 2048 characters';
  if (/[\s<>"'`]/.test(value)) return 'contains forbidden characters';
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'must be an absolute URL';
  }
  if (url.protocol !== 'https:') return 'must use https';
  if (url.username || url.password) return 'must not contain credentials';
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host.includes('.') && isIP(host) === 0) return 'must use a fully-qualified host name';
  if (PRIVATE_HOST_PATTERNS.some((p) => p.test(host)) || isPrivateIp(host)) {
    return 'must point to a public host';
  }
  const allowed = (options.allowedHosts ?? []).map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (allowed.length > 0) {
    const h = host.toLowerCase();
    if (!allowed.some((a) => h === a || h.endsWith(`.${a}`))) return 'host is not in the allowlist';
  }
  return null;
}

/** class-validator decorator wrapping {@link checkSafeExternalUrl}. */
export function IsSafeExternalUrl(validationOptions?: ValidationOptions): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isSafeExternalUrl',
      target: object.constructor,
      propertyName: propertyName as string,
      options: validationOptions,
      validator: {
        validate: (value: unknown) => checkSafeExternalUrl(value) === null,
        defaultMessage: (args) => `${args?.property ?? 'value'} ${checkSafeExternalUrl(args?.value) ?? 'is invalid'}`,
      },
    });
  };
}

/** Validates a `{ [key]: boolean }` record with safe keys (feature flags). */
export function IsBooleanRecord(validationOptions?: ValidationOptions): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isBooleanRecord',
      target: object.constructor,
      propertyName: propertyName as string,
      options: validationOptions,
      validator: {
        validate: (value: unknown) => {
          if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
          const entries = Object.entries(value as Record<string, unknown>);
          return (
            entries.length <= 100 &&
            entries.every(([k, v]) => /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(k) && typeof v === 'boolean')
          );
        },
        defaultMessage: (args) =>
          `${args?.property ?? 'value'} must be an object of at most 100 boolean flags with alphanumeric keys`,
      },
    });
  };
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

/**
 * Returns a new object with `patch` deep-merged into `base`. Plain objects merge recursively;
 * arrays and primitives replace. Prototype-pollution keys are dropped. `undefined` in the
 * patch leaves the base value unchanged.
 */
export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(patch)) return (patch === undefined ? base : patch) as T;
  const source: Record<string, unknown> = isPlainObject(base) ? base : {};
  const out: Record<string, unknown> = { ...source };
  for (const [key, value] of Object.entries(patch)) {
    if (FORBIDDEN_KEYS.has(key) || value === undefined) continue;
    out[key] = isPlainObject(value) && isPlainObject(source[key]) ? deepMerge(source[key], value) : value;
  }
  return out as T;
}

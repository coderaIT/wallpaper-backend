export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Converts arbitrary text into a URL-safe, lower-case, hyphenated slug. */
export function slugify(input: string, maxLength = 100): string {
  const slug = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
  return slug;
}

/**
 * Returns `base` if unused, otherwise `base-2`, `base-3`, ... The caller supplies an
 * existence check so this works for any table. Falls back to a random suffix after
 * many collisions to bound the number of queries.
 */
export async function generateUniqueSlug(
  source: string,
  exists: (slug: string) => Promise<boolean>,
  maxLength = 100,
): Promise<string> {
  const base = slugify(source, maxLength - 7) || 'item';
  if (!(await exists(base))) return base;
  for (let i = 2; i <= 20; i++) {
    const candidate = `${base}-${i}`;
    if (!(await exists(candidate))) return candidate;
  }
  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}

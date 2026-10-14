export const CONTENT_LOCALES = ['ar', 'tr', 'en'] as const;
export type ContentLocale = (typeof CONTENT_LOCALES)[number];
export const DEFAULT_CONTENT_LOCALE: ContentLocale = 'en';

const LOCALE_SET = new Set<string>(CONTENT_LOCALES);

export function isContentLocale(value: string | undefined | null): value is ContentLocale {
  return !!value && LOCALE_SET.has(value.toLowerCase());
}

/**
 * Public locale precedence:
 * 1. `lang` query parameter when it is `ar`, `tr`, or `en`.
 * 2. The first supported tag in `Accept-Language`, in quality order.
 * 3. English.
 */
export function resolveContentLocale(lang?: string | null, acceptLanguage?: string | null): ContentLocale {
  return normalizeLocaleToken(lang) ?? pickAcceptLanguage(acceptLanguage) ?? DEFAULT_CONTENT_LOCALE;
}

export function normalizeLocaleToken(value?: string | null): ContentLocale | null {
  if (!value) return null;
  const token = value.trim().toLowerCase().replace('_', '-').split('-')[0];
  return isContentLocale(token) ? token : null;
}

export function pickAcceptLanguage(header?: string | null): ContentLocale | null {
  if (!header) return null;
  const parts = header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      let quality = 1;
      for (const param of params) {
        const [key, raw] = param.trim().split('=');
        if (key === 'q') {
          const parsed = Number(raw);
          if (!Number.isNaN(parsed)) quality = parsed;
        }
      }
      return { tag: tag.trim(), quality };
    })
    .sort((a, b) => b.quality - a.quality);
  for (const part of parts) {
    const locale = normalizeLocaleToken(part.tag);
    if (locale) return locale;
  }
  return null;
}

export interface LocalizedFields {
  locale: string;
  primary: string;
  secondary: string | null;
}

export interface ResolvedText {
  primary: string;
  secondary: string | null;
  resolvedLocale: ContentLocale | 'legacy';
}

/**
 * Text fallback, in order:
 * 1. The requested locale, when its primary text is non-empty.
 * 2. The English translation.
 * 3. The legacy parent column (text stored before translations existed).
 * 4. Any other stored translation, Arabic then Turkish.
 *
 * Empty strings count as missing. This helper is only for human-readable text.
 */
export function resolveLocalizedText(
  rows: LocalizedFields[],
  locale: ContentLocale,
  legacy: { primary: string; secondary: string | null },
): ResolvedText {
  const byLocale = new Map<string, LocalizedFields>();
  for (const row of rows) {
    if (row.primary.trim()) byLocale.set(row.locale, { ...row, primary: row.primary.trim(), secondary: blankToNull(row.secondary) });
  }
  const requested = byLocale.get(locale);
  if (requested) return { primary: requested.primary, secondary: requested.secondary, resolvedLocale: locale };
  const english = byLocale.get(DEFAULT_CONTENT_LOCALE);
  if (english) return { primary: english.primary, secondary: english.secondary, resolvedLocale: DEFAULT_CONTENT_LOCALE };
  if (legacy.primary.trim()) {
    return { primary: legacy.primary.trim(), secondary: blankToNull(legacy.secondary), resolvedLocale: 'legacy' };
  }
  for (const code of CONTENT_LOCALES) {
    const row = byLocale.get(code);
    if (row) return { primary: row.primary, secondary: row.secondary, resolvedLocale: code };
  }
  return { primary: legacy.primary, secondary: blankToNull(legacy.secondary), resolvedLocale: 'legacy' };
}

export interface TranslationDraft {
  locale: ContentLocale;
  primary: string;
  secondary?: string | null;
}

export function normalizeTranslationDrafts(rows: TranslationDraft[] | undefined): TranslationDraft[] {
  const map = new Map<ContentLocale, TranslationDraft>();
  for (const row of rows ?? []) {
    if (!isContentLocale(row.locale)) continue;
    const primary = row.primary.trim();
    if (!primary) continue;
    map.set(row.locale, { locale: row.locale, primary, secondary: blankToNull(row.secondary) });
  }
  return [...map.values()];
}

export interface ResolvedWrite {
  rows: TranslationDraft[];
  /** When true, locales omitted from `rows` are deleted. When false, only the listed rows are upserted. */
  replace: boolean;
  parent: { primary: string; secondary: string | null };
}

/**
 * `translations` is the source of truth when present.
 * When it is omitted, a legacy name/title write upserts the English row so older admin clients keep working.
 * A publish-only update (no text fields) returns null and leaves translations untouched.
 * Existing rows are not backfilled by migrations; this runs only when an administrator saves text.
 */
export function resolveWriteTexts(input: {
  translations?: TranslationDraft[];
  legacyPrimary?: string;
  legacySecondary?: string | null;
  previous: { primary: string; secondary: string | null } | null;
}): ResolvedWrite | null {
  if (input.translations) {
    const rows = normalizeTranslationDrafts(input.translations);
    const english = rows.find((row) => row.locale === DEFAULT_CONTENT_LOCALE);
    const parent = english
      ? { primary: english.primary, secondary: english.secondary ?? null }
      : input.previous ?? {
          primary: input.legacyPrimary?.trim() || rows[0]?.primary || '',
          secondary: input.legacySecondary ?? rows[0]?.secondary ?? null,
        };
    return { rows, replace: true, parent };
  }
  if (input.legacyPrimary === undefined && input.legacySecondary === undefined) return null;
  const primary = (input.legacyPrimary ?? input.previous?.primary ?? '').trim();
  const secondary =
    input.legacySecondary !== undefined ? blankToNull(input.legacySecondary) : blankToNull(input.previous?.secondary);
  return {
    rows: primary ? [{ locale: DEFAULT_CONTENT_LOCALE, primary, secondary }] : [],
    replace: false,
    parent: { primary, secondary },
  };
}

function blankToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

import { normalizeTranslationDrafts, resolveContentLocale, resolveLocalizedText, resolveWriteTexts } from './content-locale';

describe('resolveContentLocale', () => {
  it('prefers an explicit supported lang over Accept-Language', () => {
    expect(resolveContentLocale('tr', 'ar,en;q=0.8')).toBe('tr');
    expect(resolveContentLocale('AR', undefined)).toBe('ar');
    expect(resolveContentLocale('en-US', 'tr')).toBe('en');
  });

  it('uses the highest-quality supported Accept-Language tag', () => {
    expect(resolveContentLocale(undefined, 'fr-FR,fr;q=0.9,tr;q=0.8,en;q=0.7')).toBe('tr');
    expect(resolveContentLocale('', 'de, ar-EG;q=0.5, en;q=0.4')).toBe('ar');
  });

  it('falls back to English for unsupported or missing input', () => {
    expect(resolveContentLocale('de', 'fr')).toBe('en');
    expect(resolveContentLocale(undefined, undefined)).toBe('en');
  });
});

describe('resolveLocalizedText', () => {
  const legacy = { primary: 'طبيعة', secondary: 'النص الأصلي' };

  it('returns the requested locale when present', () => {
    const resolved = resolveLocalizedText(
      [
        { locale: 'en', primary: 'Nature', secondary: 'Nature wallpapers' },
        { locale: 'ar', primary: 'طبيعة', secondary: 'خلفيات طبيعية' },
      ],
      'ar',
      legacy,
    );
    expect(resolved).toEqual({ primary: 'طبيعة', secondary: 'خلفيات طبيعية', resolvedLocale: 'ar' });
  });

  it('falls back to English, then the legacy column, then any other translation', () => {
    expect(
      resolveLocalizedText([{ locale: 'en', primary: 'Nature', secondary: null }], 'tr', legacy).resolvedLocale,
    ).toBe('en');
    expect(resolveLocalizedText([], 'tr', legacy)).toEqual({
      primary: 'طبيعة',
      secondary: 'النص الأصلي',
      resolvedLocale: 'legacy',
    });
    expect(
      resolveLocalizedText([{ locale: 'ar', primary: 'طبيعة', secondary: null }], 'tr', { primary: '', secondary: null }),
    ).toMatchObject({ primary: 'طبيعة', resolvedLocale: 'ar' });
  });

  it('treats blank translations as missing', () => {
    expect(resolveLocalizedText([{ locale: 'en', primary: '  ', secondary: null }], 'en', legacy).resolvedLocale).toBe('legacy');
  });
});

describe('resolveWriteTexts', () => {
  it('does not invent locale rows when an admin sends explicit translations', () => {
    const write = resolveWriteTexts({
      translations: [{ locale: 'ar', primary: 'طبيعة', secondary: 'خلفيات طبيعية' }],
      legacyPrimary: 'طبيعة',
      previous: null,
    });
    expect(write?.replace).toBe(true);
    expect(write?.rows.map((row) => row.locale)).toEqual(['ar']);
    expect(write?.parent.primary).toBe('طبيعة');
  });

  it('keeps the legacy name field as the English row for older clients', () => {
    const write = resolveWriteTexts({
      legacyPrimary: 'Nature',
      legacySecondary: 'Nature wallpapers',
      previous: { primary: 'Old', secondary: null },
    });
    expect(write).toEqual({
      rows: [{ locale: 'en', primary: 'Nature', secondary: 'Nature wallpapers' }],
      replace: false,
      parent: { primary: 'Nature', secondary: 'Nature wallpapers' },
    });
  });

  it('leaves translations untouched when no text is being saved', () => {
    expect(resolveWriteTexts({ previous: { primary: 'Nature', secondary: null } })).toBeNull();
  });

  it('dedupes locales and drops empty names', () => {
    expect(
      normalizeTranslationDrafts([
        { locale: 'tr', primary: '  ', secondary: null },
        { locale: 'tr', primary: 'Doğa', secondary: '  ' },
        { locale: 'tr', primary: 'Doğa 2', secondary: 'Açıklama' },
      ]),
    ).toEqual([{ locale: 'tr', primary: 'Doğa 2', secondary: 'Açıklama' }]);
  });
});

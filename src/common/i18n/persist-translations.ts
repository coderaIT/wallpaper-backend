import { Prisma } from '../../generated/prisma/client';
import { TranslationDraft } from './content-locale';

type Tx = Prisma.TransactionClient;

export async function syncCategoryTranslations(tx: Tx, categoryId: string, rows: TranslationDraft[], replace: boolean): Promise<void> {
  if (replace) {
    await tx.categoryTranslation.deleteMany({
      where: rows.length === 0 ? { categoryId } : { categoryId, locale: { notIn: rows.map((row) => row.locale) } },
    });
  }
  for (const row of rows) {
    await tx.categoryTranslation.upsert({
      where: { categoryId_locale: { categoryId, locale: row.locale } },
      create: { categoryId, locale: row.locale, name: row.primary, description: row.secondary ?? null },
      update: { name: row.primary, description: row.secondary ?? null },
    });
  }
}

export async function syncWallpaperTranslations(tx: Tx, wallpaperId: string, rows: TranslationDraft[], replace: boolean): Promise<void> {
  if (replace) {
    await tx.wallpaperTranslation.deleteMany({
      where: rows.length === 0 ? { wallpaperId } : { wallpaperId, locale: { notIn: rows.map((row) => row.locale) } },
    });
  }
  for (const row of rows) {
    await tx.wallpaperTranslation.upsert({
      where: { wallpaperId_locale: { wallpaperId, locale: row.locale } },
      create: { wallpaperId, locale: row.locale, title: row.primary, description: row.secondary ?? null },
      update: { title: row.primary, description: row.secondary ?? null },
    });
  }
}

export async function syncBannerTranslations(tx: Tx, bannerId: string, rows: TranslationDraft[], replace: boolean): Promise<void> {
  if (replace) {
    await tx.bannerTranslation.deleteMany({
      where: rows.length === 0 ? { bannerId } : { bannerId, locale: { notIn: rows.map((row) => row.locale) } },
    });
  }
  for (const row of rows) {
    await tx.bannerTranslation.upsert({
      where: { bannerId_locale: { bannerId, locale: row.locale } },
      create: { bannerId, locale: row.locale, title: row.primary, subtitle: row.secondary ?? null },
      update: { title: row.primary, subtitle: row.secondary ?? null },
    });
  }
}

export async function syncHomeSectionTranslations(tx: Tx, homeSectionId: string, rows: TranslationDraft[], replace: boolean): Promise<void> {
  if (replace) {
    await tx.homeSectionTranslation.deleteMany({
      where: rows.length === 0 ? { homeSectionId } : { homeSectionId, locale: { notIn: rows.map((row) => row.locale) } },
    });
  }
  for (const row of rows) {
    await tx.homeSectionTranslation.upsert({
      where: { homeSectionId_locale: { homeSectionId, locale: row.locale } },
      create: { homeSectionId, locale: row.locale, title: row.primary },
      update: { title: row.primary },
    });
  }
}

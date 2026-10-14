import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientPlatform, HomeSection, HomeSectionType, Prisma, WallpaperOrientation } from '../../generated/prisma/client';
import { EnvironmentVariables } from '../../config/env.validation';
import { ContentLocale, resolveLocalizedText } from '../../common/i18n/content-locale';
import { TtlCache } from '../../common/utils/ttl-cache';
import { PrismaService } from '../../prisma/prisma.service';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { BannersService, PublicBannerDto } from '../banners/banners.service';
import {
  CategoriesConfig,
  CategorySectionSort,
  CategoryWallpapersConfig,
  CustomWallpapersConfig,
  FeedConfig,
  LimitConfig,
} from '../home-sections/dto/home-section.dto';
import { PublicCategoryDto, PublicWallpaperSort, PublicWallpaperSummaryDto } from './dto/public.dto';
import { publicOrderBy, PublicCatalogService } from './public-catalog.service';
import { HomeLayoutEntry, PublicConfigService } from './public-config.service';

export interface PublicHomeSection {
  id: string;
  title: string;
  type: HomeSectionType;
  category?: { id: string; name: string; slug: string };
  items: PublicWallpaperSummaryDto[] | PublicCategoryDto[] | PublicBannerDto[];
}

const FEED_SORT: Partial<Record<HomeSectionType, PublicWallpaperSort>> = {
  FEATURED_WALLPAPERS: PublicWallpaperSort.Manual,
  POPULAR_WALLPAPERS: PublicWallpaperSort.Popular,
  LATEST_WALLPAPERS: PublicWallpaperSort.Latest,
};

/** Allowlisted ORDER BY fragments for the per-category window query (never user input). */
const CATEGORY_WINDOW_ORDER: Record<CategorySectionSort, Prisma.Sql> = {
  latest: Prisma.sql`w.published_at DESC NULLS LAST, w.id DESC`,
  popular: Prisma.sql`w.download_count DESC, w.view_count DESC, w.id DESC`,
  manual: Prisma.sql`w.sort_order ASC, w.published_at DESC NULLS LAST, w.id DESC`,
};

/**
 * Aggregates the home feed with a bounded number of queries independent of the number of
 * sections: one per distinct feed (type+orientation), one window query per distinct
 * category-section sort, one batched wallpaper lookup, one category lookup and one banner
 * query. The result is cached briefly in-process.
 */
@Injectable()
export class PublicHomeService {
  private readonly cache: TtlCache<unknown>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: PublicCatalogService,
    private readonly banners: BannersService,
    private readonly settings: AppSettingsService,
    private readonly publicConfig: PublicConfigService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.cache = new TtlCache(config.get('PUBLIC_CACHE_TTL_SECONDS', { infer: true }) * 1000, 24);
  }

  getHome(locale: ContentLocale): Promise<{ sections: PublicHomeSection[] }> {
    return this.cache.getOrLoad(`home:${locale}`, () => this.buildHome(locale)) as Promise<{ sections: PublicHomeSection[] }>;
  }

  async getAppConfig(platform?: ClientPlatform, appVersion?: string, locale: ContentLocale = 'en') {
    const sections = (await this.cache.getOrLoad(`layout:${locale}`, () => this.enabledSections())) as SectionRow[];
    const layout: HomeLayoutEntry[] = sections.map((s) => ({ id: s.id, title: sectionTitle(s, locale), type: s.sectionType }));
    return this.publicConfig.build(platform, appVersion, layout, locale);
  }

  private enabledSections() {
    return this.prisma.homeSection.findMany({
      where: { isEnabled: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: { translations: { select: { locale: true, title: true } } },
    });
  }

  private async buildHome(locale: ContentLocale): Promise<{ sections: PublicHomeSection[] }> {
    const [sections, settings] = await Promise.all([this.enabledSections(), this.settings.getSettings()]);
    const defaultLimit = settings.home.defaultSectionLimit;
    const cfg = <T,>(s: HomeSection) => s.configuration as unknown as T;
    const limitOf = (s: HomeSection) => cfg<LimitConfig>(s).limit ?? defaultLimit;

    // ---- 1. Plan: collect what every section needs ----
    const feeds = new Map<string, { type: HomeSectionType; orientation?: WallpaperOrientation; limit: number }>();
    const categoryWindows = new Map<CategorySectionSort, { categoryIds: Set<string>; limit: number }>();
    const customIds = new Set<string>();
    const explicitCategoryIds = new Set<string>();
    let allCategoriesLimit = 0;
    let bannerLimit = 0;

    for (const s of sections) {
      const limit = limitOf(s);
      switch (s.sectionType) {
        case 'FEATURED_WALLPAPERS':
        case 'POPULAR_WALLPAPERS':
        case 'LATEST_WALLPAPERS': {
          const orientation = cfg<FeedConfig>(s).orientation;
          const key = `${s.sectionType}:${orientation ?? ''}`;
          const prev = feeds.get(key);
          feeds.set(key, { type: s.sectionType, orientation, limit: Math.max(prev?.limit ?? 0, limit) });
          break;
        }
        case 'CATEGORY_WALLPAPERS': {
          const c = cfg<CategoryWallpapersConfig>(s);
          const sort = c.sort ?? 'latest';
          const entry = categoryWindows.get(sort) ?? { categoryIds: new Set<string>(), limit: 0 };
          entry.categoryIds.add(c.categoryId);
          // Over-fetch when an orientation filter is applied so filtering still fills the section.
          entry.limit = Math.max(entry.limit, c.orientation ? Math.min(limit * 3, 150) : limit);
          categoryWindows.set(sort, entry);
          explicitCategoryIds.add(c.categoryId);
          break;
        }
        case 'CUSTOM_WALLPAPERS':
          cfg<CustomWallpapersConfig>(s).wallpaperIds.forEach((id) => customIds.add(id));
          break;
        case 'CATEGORIES': {
          const ids = cfg<CategoriesConfig>(s).categoryIds;
          if (ids?.length) ids.forEach((id) => explicitCategoryIds.add(id));
          else allCategoriesLimit = Math.max(allCategoriesLimit, limit);
          break;
        }
        case 'BANNERS':
          bannerLimit = Math.max(bannerLimit, limit);
          break;
      }
    }

    // ---- 2. Fetch: bounded number of queries ----
    const feedResults = new Map<string, PublicWallpaperSummaryDto[]>();
    const categoryWindowRows = new Map<CategorySectionSort, { wallpaperId: string; categoryId: string }[]>();

    await Promise.all([
      ...[...feeds.entries()].map(async ([key, f]) => {
        const where: Prisma.WallpaperWhereInput = {
          ...(f.type === 'FEATURED_WALLPAPERS' ? { isFeatured: true } : {}),
          ...(f.orientation ? { orientation: f.orientation } : {}),
        };
        feedResults.set(key, await this.catalog.feed(where, publicOrderBy(FEED_SORT[f.type]!), f.limit, locale));
      }),
      ...[...categoryWindows.entries()].map(async ([sort, w]) => {
        categoryWindowRows.set(sort, await this.topPerCategory([...w.categoryIds], w.limit, sort));
      }),
    ]);

    const windowWallpaperIds = [...categoryWindowRows.values()].flat().map((r) => r.wallpaperId);
    const [wallpapersById, explicitCategories, allCategories, banners] = await Promise.all([
      this.catalog.wallpapersByIds([...new Set([...customIds, ...windowWallpaperIds])], locale),
      explicitCategoryIds.size ? this.catalog.categoriesByIds([...explicitCategoryIds], explicitCategoryIds.size, locale) : Promise.resolve([]),
      allCategoriesLimit ? this.catalog.categoriesByIds(null, allCategoriesLimit, locale) : Promise.resolve([]),
      bannerLimit && settings.home.bannersEnabled ? this.banners.listPublic(bannerLimit, locale) : Promise.resolve([]),
    ]);
    const categoriesById = new Map([...explicitCategories, ...allCategories].map((c) => [c.id, c]));

    // ---- 3. Assemble in section order ----
    const out: PublicHomeSection[] = [];
    for (const s of sections) {
      const limit = limitOf(s);
      const base = { id: s.id, title: sectionTitle(s, locale), type: s.sectionType };
      switch (s.sectionType) {
        case 'FEATURED_WALLPAPERS':
        case 'POPULAR_WALLPAPERS':
        case 'LATEST_WALLPAPERS': {
          const key = `${s.sectionType}:${cfg<FeedConfig>(s).orientation ?? ''}`;
          const items = (feedResults.get(key) ?? []).slice(0, limit);
          if (items.length) out.push({ ...base, items });
          break;
        }
        case 'CATEGORY_WALLPAPERS': {
          const c = cfg<CategoryWallpapersConfig>(s);
          const category = categoriesById.get(c.categoryId);
          if (!category) break;
          const items = (categoryWindowRows.get(c.sort ?? 'latest') ?? [])
            .filter((r) => r.categoryId === c.categoryId)
            .map((r) => wallpapersById.get(r.wallpaperId))
            .filter((w): w is PublicWallpaperSummaryDto => !!w && (!c.orientation || w.orientation === c.orientation))
            .slice(0, limit);
          if (items.length) out.push({ ...base, category: { id: category.id, name: category.name, slug: category.slug }, items });
          break;
        }
        case 'CUSTOM_WALLPAPERS': {
          const items = cfg<CustomWallpapersConfig>(s)
            .wallpaperIds.map((id) => wallpapersById.get(id))
            .filter((w): w is PublicWallpaperSummaryDto => !!w)
            .slice(0, limit);
          if (items.length) out.push({ ...base, items });
          break;
        }
        case 'CATEGORIES': {
          const ids = cfg<CategoriesConfig>(s).categoryIds;
          const items = ids?.length
            ? ids.map((id) => categoriesById.get(id)).filter((c): c is PublicCategoryDto => !!c).slice(0, limit)
            : allCategories.slice(0, limit);
          if (items.length) out.push({ ...base, items });
          break;
        }
        case 'BANNERS': {
          const items = banners.slice(0, limit);
          if (items.length) out.push({ ...base, items });
          break;
        }
      }
    }
    return { sections: out };
  }

  /** Top-N published wallpapers per published category in one window-function query. */
  private async topPerCategory(categoryIds: string[], limit: number, sort: CategorySectionSort) {
    if (categoryIds.length === 0) return [];
    const rows = await this.prisma.$queryRaw<{ wallpaper_id: string; category_id: string }[]>`
      SELECT t.wallpaper_id::text AS wallpaper_id, t.category_id::text AS category_id
      FROM (
        SELECT wc.wallpaper_id, wc.category_id,
               ROW_NUMBER() OVER (PARTITION BY wc.category_id ORDER BY ${CATEGORY_WINDOW_ORDER[sort]}) AS rn
        FROM wallpaper_categories wc
        JOIN wallpapers w ON w.id = wc.wallpaper_id
        JOIN categories c ON c.id = wc.category_id
        WHERE wc.category_id = ANY(${categoryIds}::uuid[])
          AND w.is_published = true
          AND c.is_published = true
      ) t
      WHERE t.rn <= ${limit}
      ORDER BY t.category_id, t.rn`;
    return rows.map((r) => ({ wallpaperId: r.wallpaper_id, categoryId: r.category_id }));
  }
}

type SectionRow = Prisma.HomeSectionGetPayload<{ include: { translations: { select: { locale: true; title: true } } } }>;

function sectionTitle(section: SectionRow, locale: ContentLocale): string {
  return resolveLocalizedText(
    section.translations.map((row) => ({ locale: row.locale, primary: row.title, secondary: null })),
    locale,
    { primary: section.title, secondary: null },
  ).primary;
}

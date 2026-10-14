import { Controller, Get, Headers, Param, ParseUUIDPipe, Query, UseInterceptors } from '@nestjs/common';
import { ApiBadRequestResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { PublicCacheInterceptor } from '../../common/interceptors/public-cache.interceptor';
import { resolveContentLocale } from '../../common/i18n/content-locale';
import { ParseSlugPipe } from '../../common/pipes/parse-slug.pipe';
import { ApiNotFound, ApiTooManyRequests, ApiValidationError } from '../../common/swagger/api-responses';
import {
  AppConfigQueryDto,
  PublicCategoryDto,
  PublicFeedQueryDto,
  PublicListQueryDto,
  PublicLocaleQueryDto,
  PublicSearchQueryDto,
  PublicWallpaperDetailDto,
  PublicWallpapersQueryDto,
} from './dto/public.dto';
import { PublicCatalogService } from './public-catalog.service';
import { PublicHomeService } from './public-home.service';

const summaryExample = {
  id: '01928c1e-0000-7000-8000-00000000a001',
  title: 'Mountain Wallpaper',
  slug: 'mountain-wallpaper',
  thumbnailUrl: 'https://cdn.example.com/media/2026/01/x/thumbnail.webp',
  previewUrl: 'https://cdn.example.com/media/2026/01/x/preview.webp',
  width: 1440,
  height: 3200,
  orientation: 'PORTRAIT',
  isFeatured: false,
};
const listExample = { data: [summaryExample], meta: { page: 1, limit: 20, total: 100, totalPages: 5 } };
const categoryExample = {
  id: '01928c1e-0000-7000-8000-00000000c001',
  name: 'Nature',
  slug: 'nature',
  description: 'Mountains, forests and oceans',
  thumbnailUrl: 'https://cdn.example.com/media/2026/01/c/thumbnail.webp',
  previewUrl: 'https://cdn.example.com/media/2026/01/c/preview.webp',
  wallpaperCount: 40,
};

@ApiTags('Public')
@Public()
@UseInterceptors(PublicCacheInterceptor)
@ApiTooManyRequests()
@Controller('public')
export class PublicController {
  constructor(
    private readonly catalog: PublicCatalogService,
    private readonly home: PublicHomeService,
  ) {}

  @Get('home')
  @ApiOperation({
    summary: 'Home feed',
    description: 'Enabled home sections in order, each resolved to published content (banners, featured, popular, latest, category, custom, categories). Constant number of queries regardless of section count; cached briefly.',
  })
  @ApiOkResponse({
    schema: {
      example: {
        data: {
          sections: [
            { id: '01928c1e-...', title: 'Featured', type: 'FEATURED_WALLPAPERS', items: [summaryExample] },
            { id: '01928c1e-...', title: 'Categories', type: 'CATEGORIES', items: [categoryExample] },
          ],
        },
      },
    },
  })
  getHome(@Query() query: PublicLocaleQueryDto, @Headers('accept-language') acceptLanguage?: string) {
    return this.home.getHome(resolveContentLocale(query.lang, acceptLanguage));
  }

  @Get('app-config')
  @ApiOperation({
    summary: 'Remote app configuration',
    description: 'Allowlisted, secret-free configuration: maintenance, version policy (pass platform + appVersion for a computed update status), announcements, download availability, home layout, links and feature flags.',
  })
  @ApiOkResponse({
    schema: {
      example: {
        data: {
          maintenance: { enabled: false, title: 'Under maintenance', message: '...', estimatedEndAt: null },
          update: {
            android: { minSupportedVersion: '1.0.0', latestVersion: '1.2.0', updateRequiredMessage: '...', updateAvailableMessage: '...', storeUrl: null },
            ios: { minSupportedVersion: '1.0.0', latestVersion: '1.2.0', updateRequiredMessage: '...', updateAvailableMessage: '...', storeUrl: null },
            status: 'AVAILABLE',
          },
          announcements: [],
          downloads: { enabled: true, allowOriginalDownload: true, disabledMessage: '...' },
          home: { bannersEnabled: true, layout: [{ id: '01928c1e-...', title: 'Featured', type: 'FEATURED_WALLPAPERS' }] },
          links: { privacyPolicyUrl: null, termsOfServiceUrl: null, supportEmail: null, websiteUrl: null, other: [] },
          features: {},
          serverTime: '2026-01-01T00:00:00.000Z',
        },
      },
    },
  })
  @ApiValidationError()
  getAppConfig(@Query() query: AppConfigQueryDto, @Headers('accept-language') acceptLanguage?: string) {
    return this.home.getAppConfig(query.platform, query.appVersion, resolveContentLocale(query.lang, acceptLanguage));
  }

  @Get('categories')
  @ApiOperation({ summary: 'Published categories (manual order)', description: 'Names and descriptions follow lang, then Accept-Language, then English, then the originally stored text.' })
  @ApiOkResponse({ schema: { example: { data: [categoryExample], meta: { page: 1, limit: 20, total: 1, totalPages: 1 } } } })
  @ApiValidationError()
  listCategories(@Query() query: PublicListQueryDto, @Headers('accept-language') acceptLanguage?: string) {
    return this.catalog.listCategories(query, resolveContentLocale(query.lang, acceptLanguage));
  }

  @Get('categories/:slug')
  @ApiOperation({ summary: 'Published category by slug', description: 'List its wallpapers with GET /public/wallpapers?categorySlug=<slug>.' })
  @ApiOkResponse({ type: PublicCategoryDto, schema: { example: { data: categoryExample } } })
  @ApiBadRequestResponse({ description: 'Malformed slug' })
  @ApiNotFound('Category')
  getCategory(@Param('slug', ParseSlugPipe) slug: string, @Query() query: PublicLocaleQueryDto, @Headers('accept-language') acceptLanguage?: string) {
    return this.catalog.getCategoryBySlug(slug, resolveContentLocale(query.lang, acceptLanguage));
  }

  @Get('wallpapers')
  @ApiOperation({
    summary: 'Published wallpapers',
    description: 'Filter by categoryId / categorySlug / orientation / q. sort=latest|popular|downloads|featured|manual|random. Random order is md5(id:seed) and stays stable for a seed. Example: /public/wallpapers?sort=random&seed=a1b2c3d4e5f67890&lang=ar',
  })
  @ApiOkResponse({ schema: { example: listExample } })
  @ApiValidationError()
  @ApiNotFound('Category')
  listWallpapers(@Query() query: PublicWallpapersQueryDto, @Headers('accept-language') acceptLanguage?: string) {
    return this.catalog.listWallpapers(query, resolveContentLocale(query.lang, acceptLanguage));
  }

  @Get('wallpapers/search')
  @ApiOperation({ summary: 'Keyword search over published wallpapers (title and tags)', description: '`q` is required (2-100 chars). Accepts the same filters as /public/wallpapers.' })
  @ApiOkResponse({ schema: { example: listExample } })
  @ApiValidationError()
  search(@Query() query: PublicSearchQueryDto, @Headers('accept-language') acceptLanguage?: string) {
    return this.catalog.listWallpapers(query, resolveContentLocale(query.lang, acceptLanguage));
  }

  @Get('wallpapers/featured')
  @ApiOperation({ summary: 'Featured wallpapers (manual order)' })
  @ApiOkResponse({ schema: { example: listExample } })
  featured(@Query() query: PublicFeedQueryDto, @Headers('accept-language') acceptLanguage?: string) {
    return this.catalog.featured(query, resolveContentLocale(query.lang, acceptLanguage));
  }

  @Get('wallpapers/latest')
  @ApiOperation({ summary: 'Newest wallpapers (by publish date)' })
  @ApiOkResponse({ schema: { example: listExample } })
  latest(@Query() query: PublicFeedQueryDto, @Headers('accept-language') acceptLanguage?: string) {
    return this.catalog.latest(query, resolveContentLocale(query.lang, acceptLanguage));
  }

  @Get('wallpapers/popular')
  @ApiOperation({ summary: 'Most popular wallpapers (confirmed downloads, then views)' })
  @ApiOkResponse({ schema: { example: listExample } })
  popular(@Query() query: PublicFeedQueryDto, @Headers('accept-language') acceptLanguage?: string) {
    return this.catalog.popular(query, resolveContentLocale(query.lang, acceptLanguage));
  }

  @Get('wallpapers/:id/related')
  @ApiOperation({
    summary: 'Related published wallpapers',
    description:
      'Metadata similarity: same categories, then shared tags, then the same orientation. Other published wallpapers fill the rest. The source wallpaper is excluded. Registered before /wallpapers/:id so the fixed path is unambiguous.',
  })
  @ApiOkResponse({ schema: { example: listExample } })
  @ApiNotFound('Wallpaper')
  related(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PublicListQueryDto,
    @Headers('accept-language') acceptLanguage?: string,
  ) {
    return this.catalog.related(id, query, resolveContentLocale(query.lang, acceptLanguage));
  }

  @Get('wallpapers/:id')
  @ApiOperation({ summary: 'Published wallpaper detail', description: '`downloadUrl` is the full-resolution original when allowed by settings, the preview when originals are disabled, or null when downloads are off.' })
  @ApiOkResponse({
    type: PublicWallpaperDetailDto,
    schema: {
      example: {
        data: {
          ...summaryExample,
          description: 'Golden light over the Alps',
          tags: ['mountain'],
          categories: [{ id: '01928c1e-0000-7000-8000-00000000c001', name: 'Nature', slug: 'nature' }],
          downloadUrl: 'https://cdn.example.com/media/2026/01/x/original.jpg',
          publishedAt: '2026-01-02T10:00:00.000Z',
        },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiNotFound('Wallpaper')
  getWallpaper(@Param('id', ParseUUIDPipe) id: string, @Query() query: PublicLocaleQueryDto, @Headers('accept-language') acceptLanguage?: string) {
    return this.catalog.getWallpaper(id, resolveContentLocale(query.lang, acceptLanguage));
  }
}

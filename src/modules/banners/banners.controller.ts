import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentAdmin } from '../../common/decorators/current-admin.decorator';
import { ReqMeta, RequestMeta } from '../../common/decorators/request-meta.decorator';
import { ReorderDto } from '../../common/dto/reorder.dto';
import { ApiAdminAuth, ApiNotFound, ApiValidationError } from '../../common/swagger/api-responses';
import { AuthenticatedAdmin } from '../auth/interfaces/authenticated-admin.interface';
import { BannersService } from './banners.service';
import { BannerResponseDto, CreateBannerDto, ListBannersQueryDto, UpdateBannerDto } from './dto/banner.dto';

const bannerExample = {
  id: '01928c1e-0000-7000-8000-00000000b001',
  title: 'Summer collection',
  subtitle: '50 new wallpapers',
  actionType: 'OPEN_CATEGORY',
  actionValue: '01928c1e-0000-7000-8000-00000000c001',
  sortOrder: 0,
  isActive: true,
  startsAt: null,
  endsAt: null,
  image: {
    mediaId: '01928c1e-0000-7000-8000-00000000aaaa',
    thumbnailUrl: 'https://cdn.example.com/media/2026/01/b/thumbnail.webp',
    previewUrl: 'https://cdn.example.com/media/2026/01/b/preview.webp',
    originalUrl: 'https://cdn.example.com/media/2026/01/b/original.jpg',
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

@ApiTags('Admin / Banners')
@ApiAdminAuth()
@Controller('admin/banners')
export class BannersController {
  constructor(private readonly banners: BannersService) {}

  @Get()
  @ApiOperation({ summary: 'List banners (display order)' })
  @ApiOkResponse({ schema: { example: { data: [bannerExample], meta: { page: 1, limit: 20, total: 1, totalPages: 1 } } } })
  list(@Query() query: ListBannersQueryDto) {
    return this.banners.list(query);
  }

  @Post()
  @ApiOperation({
    summary: 'Create a banner',
    description: 'Upload the image via POST /admin/media first. OPEN_URL values must be public https URLs (and match BANNER_URL_ALLOWED_HOSTS if configured).',
  })
  @ApiBody({
    type: CreateBannerDto,
    examples: {
      category: { value: { title: 'Nature', imageMediaId: '01928c1e-...', actionType: 'OPEN_CATEGORY', actionValue: '01928c1e-...', isActive: true } },
      url: { value: { title: 'Our website', imageMediaId: '01928c1e-...', actionType: 'OPEN_URL', actionValue: 'https://example.com/promo', isActive: true } },
    },
  })
  @ApiCreatedResponse({ type: BannerResponseDto, schema: { example: { data: bannerExample } } })
  @ApiValidationError()
  @ApiNotFound('Image media or action target')
  create(@Body() dto: CreateBannerDto, @CurrentAdmin() admin: AuthenticatedAdmin, @ReqMeta() meta: RequestMeta) {
    return this.banners.create(dto, admin, meta);
  }

  @Patch('reorder')
  @ApiOperation({ summary: 'Reorder banners' })
  @ApiOkResponse({ schema: { example: { data: { updated: 2 } } } })
  @ApiValidationError()
  reorder(@Body() dto: ReorderDto, @CurrentAdmin() admin: AuthenticatedAdmin, @ReqMeta() meta: RequestMeta) {
    return this.banners.reorder(dto, admin, meta);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a banner' })
  @ApiOkResponse({ type: BannerResponseDto, schema: { example: { data: bannerExample } } })
  @ApiNotFound('Banner')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.banners.get(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a banner (content, action, activation, schedule, order)' })
  @ApiOkResponse({ type: BannerResponseDto, schema: { example: { data: bannerExample } } })
  @ApiValidationError()
  @ApiNotFound('Banner')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBannerDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.banners.update(id, dto, admin, meta);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a banner (the image media is kept)' })
  @ApiNoContentResponse()
  @ApiNotFound('Banner')
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentAdmin() admin: AuthenticatedAdmin, @ReqMeta() meta: RequestMeta): Promise<void> {
    await this.banners.remove(id, admin, meta);
  }
}

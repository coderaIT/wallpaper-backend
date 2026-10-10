import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentAdmin } from '../../common/decorators/current-admin.decorator';
import { ReqMeta, RequestMeta } from '../../common/decorators/request-meta.decorator';
import { ApiAdminAuth, ApiConflict, ApiNotFound, ApiValidationError } from '../../common/swagger/api-responses';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedAdmin } from '../auth/interfaces/authenticated-admin.interface';
import {
  BulkCreateWallpapersDto,
  BulkUpdateWallpapersDto,
  CreateWallpaperDto,
  DeleteWallpaperQueryDto,
  ListWallpapersQueryDto,
  PublishWallpaperDto,
  UpdateWallpaperDto,
  UploadWallpapersFormDto,
  WallpaperAdminResponseDto,
} from './dto/wallpaper.dto';
import { WallpapersService } from './wallpapers.service';

export const wallpaperAdminExample = {
  id: '01928c1e-0000-7000-8000-00000000w001',
  title: 'Mountain Sunrise',
  description: 'Golden light over the Alps',
  slug: 'mountain-sunrise',
  tags: ['mountain', 'sunrise'],
  orientation: 'PORTRAIT',
  width: 1440,
  height: 3200,
  isFeatured: true,
  isPublished: true,
  sortOrder: 0,
  publishedAt: '2026-01-02T10:00:00.000Z',
  image: {
    mediaId: '01928c1e-0000-7000-8000-00000000aaaa',
    thumbnailUrl: 'https://cdn.example.com/media/2026/01/x/thumbnail.webp',
    previewUrl: 'https://cdn.example.com/media/2026/01/x/preview.webp',
    originalUrl: 'https://cdn.example.com/media/2026/01/x/original.jpg',
  },
  categories: [{ id: '01928c1e-0000-7000-8000-00000000c001', name: 'Nature', slug: 'nature' }],
  stats: { views: 1200, downloadClicks: 340, downloads: 310 },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T10:00:00.000Z',
};

const listExample = { data: [wallpaperAdminExample], meta: { page: 1, limit: 20, total: 1, totalPages: 1 } };

@ApiTags('Admin / Wallpapers')
@ApiAdminAuth()
@Controller('admin/wallpapers')
export class WallpapersController {
  constructor(private readonly wallpapers: WallpapersService) {}

  @Post()
  @ApiOperation({ summary: 'Create a wallpaper from an uploaded image', description: 'Upload the image via POST /admin/media first, then reference its id.' })
  @ApiBody({
    type: CreateWallpaperDto,
    examples: {
      default: {
        value: {
          title: 'Mountain Sunrise',
          mediaId: '01928c1e-0000-7000-8000-00000000aaaa',
          categoryIds: ['01928c1e-0000-7000-8000-00000000c001'],
          tags: ['mountain', 'sunrise'],
          isPublished: true,
        },
      },
    },
  })
  @ApiCreatedResponse({ type: WallpaperAdminResponseDto, schema: { example: { data: wallpaperAdminExample } } })
  @ApiValidationError()
  @ApiNotFound('Media or category')
  @ApiConflict('Slug is already in use')
  create(@Body() dto: CreateWallpaperDto, @CurrentAdmin() admin: AuthenticatedAdmin, @ReqMeta() meta: RequestMeta) {
    return this.wallpapers.create(dto, admin, meta);
  }

  @Post('bulk')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Create many wallpapers from uploaded images',
    description: 'One wallpaper per item. Items succeed or fail independently; see `results` for per-item errors.',
  })
  @ApiOkResponse({
    schema: {
      example: {
        data: {
          succeeded: 1,
          failed: 1,
          results: [
            { index: 0, filename: null, status: 'success', item: wallpaperAdminExample },
            { index: 1, filename: null, status: 'error', error: { statusCode: 404, message: 'Media 0192... not found' } },
          ],
        },
      },
    },
  })
  @ApiValidationError()
  bulkCreate(@Body() dto: BulkCreateWallpapersDto, @CurrentAdmin() admin: AuthenticatedAdmin, @ReqMeta() meta: RequestMeta) {
    return this.wallpapers.bulkCreate(dto, admin, meta);
  }

  @Post('upload')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FilesInterceptor('files'))
  @ApiOperation({
    summary: 'Upload images and create wallpapers in one step',
    description: 'Multipart: repeatable `files` plus optional `categoryIds` (comma-separated), `isPublished`, `isFeatured`. Titles are derived from file names.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['files'],
      properties: {
        files: { type: 'array', items: { type: 'string', format: 'binary' } },
        categoryIds: { type: 'string', example: '01928c1e-0000-7000-8000-00000000c001' },
        isPublished: { type: 'string', enum: ['true', 'false'] },
        isFeatured: { type: 'string', enum: ['true', 'false'] },
      },
    },
  })
  @ApiOkResponse({ description: 'Per-file results (same shape as POST /bulk)' })
  upload(
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @Body() form: UploadWallpapersFormDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @ReqMeta() meta: RequestMeta,
  ) {
    if (!files || files.length === 0) throw new BadRequestException('At least one file must be provided in the "files" field');
    return this.wallpapers.uploadAndCreate(files, form, admin, meta);
  }

  @Get()
  @ApiOperation({
    summary: 'List wallpapers',
    description: 'Search, filter by category / publish state / featured / orientation, sort by date, popularity or manual order. Paginated.',
  })
  @ApiOkResponse({ schema: { example: listExample } })
  @ApiValidationError()
  list(@Query() query: ListWallpapersQueryDto) {
    return this.wallpapers.list(query);
  }

  @Patch('bulk')
  @ApiOperation({
    summary: 'Bulk update wallpapers',
    description:
      'Actions: PUBLISH, UNPUBLISH, FEATURE, UNFEATURE, ADD_CATEGORIES, REMOVE_CATEGORIES (need `categoryIds`), DELETE (need `ids`), REORDER (needs `items`). Unknown ids are reported per item.',
  })
  @ApiBody({
    type: BulkUpdateWallpapersDto,
    examples: {
      publish: { value: { action: 'PUBLISH', ids: ['01928c1e-0000-7000-8000-00000000w001'] } },
      addCategories: { value: { action: 'ADD_CATEGORIES', ids: ['01928c1e-0000-7000-8000-00000000w001'], categoryIds: ['01928c1e-0000-7000-8000-00000000c001'] } },
      reorder: { value: { action: 'REORDER', items: [{ id: '01928c1e-0000-7000-8000-00000000w001', sortOrder: 3 }] } },
    },
  })
  @ApiOkResponse({
    schema: {
      example: {
        data: {
          action: 'PUBLISH',
          succeeded: 1,
          failed: 1,
          results: [
            { id: '01928c1e-0000-7000-8000-00000000w001', status: 'success' },
            { id: '01928c1e-0000-7000-8000-00000000w999', status: 'error', error: { statusCode: 404, message: 'Wallpaper not found' } },
          ],
        },
      },
    },
  })
  @ApiValidationError()
  bulkUpdate(@Body() dto: BulkUpdateWallpapersDto, @CurrentAdmin() admin: AuthenticatedAdmin, @ReqMeta() meta: RequestMeta) {
    return this.wallpapers.bulkUpdate(dto, admin, meta);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a wallpaper (any publish state)' })
  @ApiOkResponse({ type: WallpaperAdminResponseDto, schema: { example: { data: wallpaperAdminExample } } })
  @ApiNotFound('Wallpaper')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.wallpapers.get(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update wallpaper metadata, image, categories, tags, flags or order' })
  @ApiOkResponse({ type: WallpaperAdminResponseDto, schema: { example: { data: wallpaperAdminExample } } })
  @ApiValidationError()
  @ApiNotFound('Wallpaper, media or category')
  @ApiConflict('Slug is already in use')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWallpaperDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.wallpapers.update(id, dto, admin, meta);
  }

  @Patch(':id/publish')
  @ApiOperation({ summary: 'Publish or unpublish a wallpaper', description: 'publishedAt is set the first time a wallpaper is published.' })
  @ApiBody({ type: PublishWallpaperDto, examples: { publish: { value: { isPublished: true } } } })
  @ApiOkResponse({ type: WallpaperAdminResponseDto, schema: { example: { data: wallpaperAdminExample } } })
  @ApiNotFound('Wallpaper')
  publish(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PublishWallpaperDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.wallpapers.setPublished(id, dto.isPublished, admin, meta);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a wallpaper', description: 'The image is kept for reuse unless `deleteMedia=true` and it is no longer referenced.' })
  @ApiNoContentResponse()
  @ApiNotFound('Wallpaper')
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: DeleteWallpaperQueryDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @ReqMeta() meta: RequestMeta,
  ): Promise<void> {
    await this.wallpapers.remove(id, query.deleteMedia, admin, meta);
  }
}

@ApiTags('Admin / Categories')
@ApiAdminAuth()
@Controller('admin/categories')
export class CategoryWallpapersController {
  constructor(
    private readonly wallpapers: WallpapersService,
    private readonly prisma: PrismaService,
  ) {}

  @Get(':id/wallpapers')
  @ApiOperation({ summary: 'List wallpapers belonging to a category', description: 'Same filters/sorting as GET /admin/wallpapers.' })
  @ApiOkResponse({ schema: { example: listExample } })
  @ApiNotFound('Category')
  async list(@Param('id', ParseUUIDPipe) id: string, @Query() query: ListWallpapersQueryDto) {
    const exists = await this.prisma.category.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException('Category not found');
    return this.wallpapers.list(query, id);
  }
}

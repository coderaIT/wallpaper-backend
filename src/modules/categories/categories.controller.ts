import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentAdmin } from '../../common/decorators/current-admin.decorator';
import { ReqMeta, RequestMeta } from '../../common/decorators/request-meta.decorator';
import { ReorderDto } from '../../common/dto/reorder.dto';
import { ApiAdminAuth, ApiConflict, ApiNotFound, ApiValidationError } from '../../common/swagger/api-responses';
import { AuthenticatedAdmin } from '../auth/interfaces/authenticated-admin.interface';
import { CategoriesService } from './categories.service';
import {
  CategoryDeletionImpactDto,
  CategoryResponseDto,
  CreateCategoryDto,
  DeleteCategoryQueryDto,
  ListCategoriesQueryDto,
  SetCategoryCoverDto,
  UpdateCategoryDto,
} from './dto/category.dto';

export const categoryExample = {
  id: '01928c1e-0000-7000-8000-00000000c001',
  name: 'Nature',
  slug: 'nature',
  description: 'Mountains, forests and oceans',
  sortOrder: 0,
  isPublished: true,
  cover: {
    mediaId: '01928c1e-0000-7000-8000-00000000aaaa',
    thumbnailUrl: 'https://cdn.example.com/media/2026/01/x/thumbnail.webp',
    previewUrl: 'https://cdn.example.com/media/2026/01/x/preview.webp',
    originalUrl: 'https://cdn.example.com/media/2026/01/x/original.jpg',
  },
  wallpaperCount: 42,
  publishedWallpaperCount: 40,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

@ApiTags('Admin / Categories')
@ApiAdminAuth()
@Controller('admin/categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a category', description: 'Slug is generated from the name when omitted; must be unique.' })
  @ApiCreatedResponse({ type: CategoryResponseDto, schema: { example: { data: categoryExample } } })
  @ApiValidationError()
  @ApiConflict('Slug is already in use')
  @ApiNotFound('Cover media')
  create(@Body() dto: CreateCategoryDto, @CurrentAdmin() admin: AuthenticatedAdmin, @ReqMeta() meta: RequestMeta) {
    return this.categories.create(dto, admin, meta);
  }

  @Get()
  @ApiOperation({ summary: 'List categories (paginated, searchable, with wallpaper counts)' })
  @ApiOkResponse({ schema: { example: { data: [categoryExample], meta: { page: 1, limit: 20, total: 1, totalPages: 1 } } } })
  @ApiValidationError()
  list(@Query() query: ListCategoriesQueryDto) {
    return this.categories.list(query);
  }

  @Patch('reorder')
  @ApiOperation({ summary: 'Reorder categories', description: 'Sets sortOrder for the given categories in one transaction.' })
  @ApiOkResponse({ schema: { example: { data: { updated: 2 } } } })
  @ApiValidationError()
  @ApiNotFound('Category')
  reorder(@Body() dto: ReorderDto, @CurrentAdmin() admin: AuthenticatedAdmin, @ReqMeta() meta: RequestMeta) {
    return this.categories.reorder(dto, admin, meta);
  }

  @Get(':id/deletion-impact')
  @ApiOperation({
    summary: 'Preview category deletion',
    description:
      'Counts wallpapers linked to the category, how many belong only to it, how many are shared with other categories, and how many media files could be cleaned up.',
  })
  @ApiOkResponse({ type: CategoryDeletionImpactDto })
  @ApiNotFound('Category')
  deletionImpact(@Param('id', ParseUUIDPipe) id: string) {
    return this.categories.deletionImpact(id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a category' })
  @ApiOkResponse({ type: CategoryResponseDto, schema: { example: { data: categoryExample } } })
  @ApiNotFound('Category')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.categories.get(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a category (name, slug, description, publish state, order)' })
  @ApiOkResponse({ type: CategoryResponseDto, schema: { example: { data: categoryExample } } })
  @ApiValidationError()
  @ApiNotFound('Category')
  @ApiConflict('Slug is already in use')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.categories.update(id, dto, admin, meta);
  }

  @Patch(':id/cover')
  @ApiOperation({
    summary: 'Set or remove the category cover image',
    description: 'Upload the image first via POST /admin/media, then pass its id. Pass null to remove the cover.',
  })
  @ApiOkResponse({ type: CategoryResponseDto, schema: { example: { data: categoryExample } } })
  @ApiValidationError()
  @ApiNotFound('Category or media')
  setCover(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetCategoryCoverDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.categories.setCover(id, dto.mediaId, admin, meta);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a category',
    description:
      'Removes the category and its links. Pass deleteExclusiveWallpapers=true to also delete wallpapers that belong only to this category. Wallpapers shared with other categories are preserved, and media still referenced elsewhere is kept.',
  })
  @ApiNoContentResponse()
  @ApiNotFound('Category')
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: DeleteCategoryQueryDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @ReqMeta() meta: RequestMeta,
  ): Promise<void> {
    await this.categories.remove(id, query.deleteExclusiveWallpapers, admin, meta);
  }
}

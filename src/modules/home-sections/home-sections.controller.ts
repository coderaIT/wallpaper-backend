import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentAdmin } from '../../common/decorators/current-admin.decorator';
import { ReqMeta, RequestMeta } from '../../common/decorators/request-meta.decorator';
import { ReorderDto } from '../../common/dto/reorder.dto';
import { ApiAdminAuth, ApiNotFound, ApiValidationError } from '../../common/swagger/api-responses';
import { AuthenticatedAdmin } from '../auth/interfaces/authenticated-admin.interface';
import { CONFIG_EXAMPLES, CreateHomeSectionDto, HomeSectionResponseDto, UpdateHomeSectionDto } from './dto/home-section.dto';
import { HomeSectionsService } from './home-sections.service';

const sectionExample = {
  id: '01928c1e-0000-7000-8000-00000000h001',
  title: 'Nature picks',
  sectionType: 'CATEGORY_WALLPAPERS',
  sortOrder: 2,
  isEnabled: true,
  configuration: CONFIG_EXAMPLES.CATEGORY_WALLPAPERS,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

@ApiTags('Admin / Home Sections')
@ApiAdminAuth()
@Controller('admin/home-sections')
export class HomeSectionsController {
  constructor(private readonly sections: HomeSectionsService) {}

  @Get()
  @ApiOperation({ summary: 'List all home sections in display order (including disabled)' })
  @ApiOkResponse({ schema: { example: { data: [sectionExample] } } })
  list() {
    return this.sections.list();
  }

  @Post()
  @ApiOperation({
    summary: 'Add a home section',
    description:
      'Configuration per type: BANNERS {limit?}; FEATURED/POPULAR/LATEST_WALLPAPERS {limit?, orientation?}; CATEGORY_WALLPAPERS {categoryId, limit?, sort?: latest|popular|manual, orientation?}; CUSTOM_WALLPAPERS {wallpaperIds[]}; CATEGORIES {categoryIds?: uuid[]|null, limit?}. limit 1-50 (defaults to settings.home.defaultSectionLimit).',
  })
  @ApiBody({
    type: CreateHomeSectionDto,
    examples: Object.fromEntries(
      Object.entries(CONFIG_EXAMPLES).map(([type, configuration]) => [type, { value: { title: type, sectionType: type, configuration } }]),
    ),
  })
  @ApiCreatedResponse({ type: HomeSectionResponseDto, schema: { example: { data: sectionExample } } })
  @ApiValidationError()
  @ApiNotFound('Referenced category or wallpaper')
  create(@Body() dto: CreateHomeSectionDto, @CurrentAdmin() admin: AuthenticatedAdmin, @ReqMeta() meta: RequestMeta) {
    return this.sections.create(dto, admin, meta);
  }

  @Patch('reorder')
  @ApiOperation({ summary: 'Reorder home sections' })
  @ApiOkResponse({ schema: { example: { data: { updated: 3 } } } })
  @ApiValidationError()
  reorder(@Body() dto: ReorderDto, @CurrentAdmin() admin: AuthenticatedAdmin, @ReqMeta() meta: RequestMeta) {
    return this.sections.reorder(dto, admin, meta);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a home section' })
  @ApiOkResponse({ type: HomeSectionResponseDto, schema: { example: { data: sectionExample } } })
  @ApiNotFound('Home section')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.sections.get(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update title, type, visibility, order or configuration' })
  @ApiOkResponse({ type: HomeSectionResponseDto, schema: { example: { data: sectionExample } } })
  @ApiValidationError()
  @ApiNotFound('Home section')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateHomeSectionDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.sections.update(id, dto, admin, meta);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a home section' })
  @ApiNoContentResponse()
  @ApiNotFound('Home section')
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentAdmin() admin: AuthenticatedAdmin, @ReqMeta() meta: RequestMeta): Promise<void> {
    await this.sections.remove(id, admin, meta);
  }
}

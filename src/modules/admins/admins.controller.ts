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
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentAdmin } from '../../common/decorators/current-admin.decorator';
import { ReqMeta, RequestMeta } from '../../common/decorators/request-meta.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ApiAdminAuth, ApiConflict, ApiNotFound, ApiValidationError } from '../../common/swagger/api-responses';
import { AuthenticatedAdmin } from '../auth/interfaces/authenticated-admin.interface';
import { AdminsService } from './admins.service';
import { AdminResponseDto, CreateAdminDto, ListAdminsQueryDto, ResetAdminPasswordDto, UpdateAdminDto } from './dto/admin.dto';

const adminExample = {
  id: '01928c1e-0000-7000-8000-000000000001',
  name: 'Jane Editor',
  email: 'jane@example.com',
  role: 'EDITOR',
  isActive: true,
  lastLoginAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

@ApiTags('Admin / Admins')
@ApiAdminAuth()
@Roles('SUPER_ADMIN')
@Controller('admin/admins')
export class AdminsController {
  constructor(private readonly admins: AdminsService) {}

  @Get()
  @ApiOperation({ summary: 'List admin accounts (SUPER_ADMIN)' })
  @ApiOkResponse({ schema: { example: { data: [adminExample], meta: { page: 1, limit: 20, total: 1, totalPages: 1 } } } })
  list(@Query() query: ListAdminsQueryDto) {
    return this.admins.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an admin account (SUPER_ADMIN)' })
  @ApiOkResponse({ type: AdminResponseDto, schema: { example: { data: adminExample } } })
  @ApiNotFound('Admin')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.admins.get(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create an admin account (SUPER_ADMIN)' })
  @ApiCreatedResponse({ type: AdminResponseDto, schema: { example: { data: adminExample } } })
  @ApiValidationError()
  @ApiConflict('An admin with this email already exists')
  create(@Body() dto: CreateAdminDto, @CurrentAdmin() actor: AuthenticatedAdmin, @ReqMeta() meta: RequestMeta) {
    return this.admins.create(dto, actor, meta);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update name, role or active flag (SUPER_ADMIN)',
    description: 'Cannot disable/demote yourself or remove the last active SUPER_ADMIN. Disabling revokes all sessions.',
  })
  @ApiOkResponse({ type: AdminResponseDto, schema: { example: { data: adminExample } } })
  @ApiValidationError()
  @ApiNotFound('Admin')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAdminDto,
    @CurrentAdmin() actor: AuthenticatedAdmin,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.admins.update(id, dto, actor, meta);
  }

  @Patch(':id/password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Reset another admin's password (SUPER_ADMIN)", description: 'Revokes all of their sessions and clears lockout.' })
  @ApiNoContentResponse()
  @ApiValidationError()
  @ApiNotFound('Admin')
  async resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResetAdminPasswordDto,
    @CurrentAdmin() actor: AuthenticatedAdmin,
    @ReqMeta() meta: RequestMeta,
  ): Promise<void> {
    await this.admins.resetPassword(id, dto.newPassword, actor, meta);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an admin account (SUPER_ADMIN)', description: 'Audit history is preserved (admin reference set to null).' })
  @ApiNoContentResponse()
  @ApiNotFound('Admin')
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentAdmin() actor: AuthenticatedAdmin, @ReqMeta() meta: RequestMeta): Promise<void> {
    await this.admins.remove(id, actor, meta);
  }
}

import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentAdmin } from '../../common/decorators/current-admin.decorator';
import { ReqMeta, RequestMeta } from '../../common/decorators/request-meta.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ApiAdminAuth, ApiConflict, ApiValidationError } from '../../common/swagger/api-responses';
import { AuthenticatedAdmin } from '../auth/interfaces/authenticated-admin.interface';
import { buildDefaultAppSettings } from './app-settings.defaults';
import { AppSettingsService } from './app-settings.service';
import { UpdateAppSettingsDto } from './dto/app-settings.dto';

const settingsExample = {
  data: { version: 3, updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: { id: '01928c1e-...', name: 'Super Admin' }, settings: buildDefaultAppSettings() },
};

@ApiTags('Admin / Settings')
@ApiAdminAuth()
@Controller('admin/settings')
export class AppSettingsController {
  constructor(private readonly settings: AppSettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Get the full remote app configuration', description: 'Includes the document version for optimistic concurrency.' })
  @ApiOkResponse({ schema: { example: settingsExample } })
  get() {
    return this.settings.get();
  }

  @Patch()
  @Roles('SUPER_ADMIN')
  @ApiOperation({
    summary: 'Update remote app configuration (SUPER_ADMIN)',
    description:
      'Partial update: groups are deep-merged into the stored document (arrays are replaced) and the merged result is fully validated before saving. Send `expectedVersion` to reject concurrent edits with 409.',
  })
  @ApiBody({
    type: UpdateAppSettingsDto,
    examples: {
      maintenance: { value: { expectedVersion: 3, maintenance: { enabled: true, message: 'Back at 18:00 UTC' } } },
      forceUpdate: { value: { appUpdate: { android: { minSupportedVersion: '2.0.0', latestVersion: '2.1.0' } } } },
      disableDownloads: { value: { downloads: { enabled: false } } },
      announcement: {
        value: {
          announcements: [
            { id: 'summer', title: 'Summer pack', message: '50 new wallpapers', level: 'PROMO', actionUrl: null, dismissible: true, isActive: true, startsAt: null, endsAt: null },
          ],
        },
      },
    },
  })
  @ApiOkResponse({ schema: { example: settingsExample } })
  @ApiValidationError()
  @ApiConflict('Settings were modified by someone else')
  update(@Body() dto: UpdateAppSettingsDto, @CurrentAdmin() admin: AuthenticatedAdmin, @ReqMeta() meta: RequestMeta) {
    return this.settings.update(dto, admin, meta);
  }
}

import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { ApiAdminAuth, ApiValidationError } from '../../common/swagger/api-responses';
import { AuditLogsService } from './audit-logs.service';
import { ListAuditLogsQueryDto } from './dto/list-audit-logs.query.dto';

@ApiTags('Admin / Audit Logs')
@ApiAdminAuth()
@Roles('SUPER_ADMIN')
@Controller('admin/audit-logs')
export class AuditLogsController {
  constructor(private readonly auditLogs: AuditLogsService) {}

  @Get()
  @ApiOperation({ summary: 'List audit log entries (SUPER_ADMIN)', description: 'Newest first, filterable and paginated.' })
  @ApiOkResponse({
    schema: {
      example: {
        data: [
          {
            id: '01928c1e-0000-7000-8000-000000000001',
            adminId: '01928c1e-0000-7000-8000-000000000002',
            action: 'WALLPAPER_PUBLISHED',
            entityType: 'WALLPAPER',
            entityId: '01928c1e-0000-7000-8000-000000000003',
            metadata: { title: 'Mountain' },
            ipAddress: '203.0.113.10',
            userAgent: 'Mozilla/5.0',
            createdAt: '2026-01-01T00:00:00.000Z',
            admin: { id: '01928c1e-0000-7000-8000-000000000002', name: 'Jane', email: 'jane@example.com' },
          },
        ],
        meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
      },
    },
  })
  @ApiValidationError()
  list(@Query() query: ListAuditLogsQueryDto) {
    return this.auditLogs.list(query);
  }
}

import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { ApiAdminAuth, ApiValidationError } from '../../common/swagger/api-responses';
import { DashboardService } from './dashboard.service';
import { DashboardLimitQueryDto } from './dto/dashboard.dto';

@ApiTags('Admin / Dashboard')
@ApiAdminAuth()
@Controller('admin/dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Content counts, analytics totals (today / 7 / 30 days, UTC) and top wallpapers of the last 7 days' })
  @ApiOkResponse({
    schema: {
      example: {
        data: {
          content: {
            wallpapers: { total: 120, published: 100, unpublished: 20, featured: 12 },
            categories: { total: 10, published: 8 },
            banners: { total: 4, activeNow: 2 },
            mediaOriginals: 130,
          },
          analytics: {
            today: { views: 50, downloadClicks: 12, downloads: 10 },
            last7Days: { views: 400, downloadClicks: 90, downloads: 80 },
            last30Days: { views: 1500, downloadClicks: 320, downloads: 290 },
          },
          topWallpapersLast7Days: [],
        },
      },
    },
  })
  overview() {
    return this.dashboard.overview();
  }

  @Get('recent-wallpapers')
  @ApiOperation({ summary: 'Most recently created wallpapers' })
  @ApiValidationError()
  @ApiOkResponse({
    schema: {
      example: {
        data: [
          {
            id: '01928c1e-...',
            title: 'Mountain',
            slug: 'mountain',
            isPublished: true,
            isFeatured: false,
            createdAt: '2026-01-01T00:00:00.000Z',
            publishedAt: '2026-01-01T00:00:00.000Z',
            thumbnailUrl: 'https://cdn.example.com/...',
          },
        ],
      },
    },
  })
  recentWallpapers(@Query() query: DashboardLimitQueryDto) {
    return this.dashboard.recentWallpapers(query.limit);
  }

  @Get('recent-activity')
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Latest audit log entries (SUPER_ADMIN)' })
  @ApiValidationError()
  @ApiOkResponse({
    schema: {
      example: {
        data: [
          {
            id: '01928c1e-...',
            action: 'WALLPAPER_PUBLISHED',
            entityType: 'WALLPAPER',
            entityId: '01928c1e-...',
            metadata: { title: 'Mountain' },
            createdAt: '2026-01-01T00:00:00.000Z',
            admin: { id: '01928c1e-...', name: 'Editor' },
          },
        ],
      },
    },
  })
  recentActivity(@Query() query: DashboardLimitQueryDto) {
    return this.dashboard.recentActivity(query.limit);
  }

  @Get('storage')
  @ApiOperation({ summary: 'Storage usage by variant (bytes as recorded at upload) and unused original count' })
  @ApiOkResponse({
    schema: {
      example: {
        data: {
          provider: 's3',
          totalBytes: 734003200,
          variants: { ORIGINAL: { count: 130, bytes: 600000000 }, PREVIEW: { count: 130, bytes: 100000000 }, THUMBNAIL: { count: 130, bytes: 34003200 } },
          unusedOriginals: 3,
        },
      },
    },
  })
  storage() {
    return this.dashboard.storage();
  }
}

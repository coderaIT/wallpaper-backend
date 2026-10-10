import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiAdminAuth, ApiValidationError } from '../../common/swagger/api-responses';
import { AnalyticsReportsService } from './analytics-reports.service';
import { DateRangeQueryDto, PopularQueryDto } from './dto/analytics.dto';

const range = { from: '2026-01-01', to: '2026-01-30' };

@ApiTags('Admin / Analytics')
@ApiAdminAuth()
@Controller('admin/analytics')
export class AnalyticsController {
  constructor(private readonly reports: AnalyticsReportsService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Totals, previous-period comparison, all-time counters and a daily series (UTC dates, default last 30 days)' })
  @ApiOkResponse({
    schema: {
      example: {
        data: {
          range,
          totals: { views: 1200, downloadClicks: 300, downloads: 260 },
          previousPeriod: { from: '2025-12-02', to: '2025-12-31', views: 900, downloadClicks: 200, downloads: 180 },
          allTime: { views: 50000, downloadClicks: 9000, downloads: 8000 },
          series: [{ date: '2026-01-01', views: 40, downloadClicks: 10, downloads: 9 }],
        },
      },
    },
  })
  @ApiValidationError()
  overview(@Query() query: DateRangeQueryDto) {
    return this.reports.overview(query);
  }

  @Get('downloads')
  @ApiOperation({ summary: 'Download clicks vs confirmed downloads per day, conversion rate and platform split' })
  @ApiOkResponse({
    schema: {
      example: {
        data: {
          range,
          totals: { downloadClicks: 300, downloads: 260, conversionRate: 0.8667 },
          series: [{ date: '2026-01-01', downloadClicks: 10, downloads: 9, conversionRate: 0.9 }],
          byPlatform: [{ platform: 'ANDROID', downloadClicks: 200, downloads: 180 }],
        },
      },
    },
  })
  @ApiValidationError()
  downloads(@Query() query: DateRangeQueryDto) {
    return this.reports.downloads(query);
  }

  @Get('popular-wallpapers')
  @ApiOperation({ summary: 'Top wallpapers in a date range by views, download clicks or downloads' })
  @ApiOkResponse({
    schema: {
      example: {
        data: {
          range,
          metric: 'downloads',
          items: [
            {
              wallpaper: { id: '01928c1e-...', title: 'Mountain', slug: 'mountain', isPublished: true, thumbnailUrl: 'https://cdn.example.com/...' },
              views: 500,
              downloadClicks: 120,
              downloads: 100,
            },
          ],
        },
      },
    },
  })
  @ApiValidationError()
  popularWallpapers(@Query() query: PopularQueryDto) {
    return this.reports.popularWallpapers(query);
  }

  @Get('popular-categories')
  @ApiOperation({ summary: 'Top categories in a date range (sums of their wallpapers)' })
  @ApiOkResponse({
    schema: {
      example: {
        data: { range, metric: 'downloads', items: [{ category: { id: '01928c1e-...', name: 'Nature', slug: 'nature' }, views: 900, downloadClicks: 200, downloads: 170 }] },
      },
    },
  })
  @ApiValidationError()
  popularCategories(@Query() query: PopularQueryDto) {
    return this.reports.popularCategories(query);
  }
}

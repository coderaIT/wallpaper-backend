import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { MediaModule } from '../media/media.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [AnalyticsModule, MediaModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}

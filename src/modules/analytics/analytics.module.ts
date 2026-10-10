import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { AnalyticsIngestService } from './analytics-ingest.service';
import { AnalyticsReportsService } from './analytics-reports.service';
import { AnalyticsController } from './analytics.controller';
import { PublicEventsController } from './public-events.controller';

@Module({
  imports: [MediaModule],
  controllers: [AnalyticsController, PublicEventsController],
  providers: [AnalyticsIngestService, AnalyticsReportsService],
  exports: [AnalyticsIngestService, AnalyticsReportsService],
})
export class AnalyticsModule {}

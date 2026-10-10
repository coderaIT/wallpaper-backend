import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiAcceptedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { ApiTooManyRequests, ApiValidationError } from '../../common/swagger/api-responses';
import { UseThrottleProfile } from '../../common/throttling/throttle-profile.decorator';
import { AnalyticsIngestService } from './analytics-ingest.service';
import { MAX_EVENTS_PER_BATCH, TrackEventsDto, TrackEventsResultDto } from './dto/analytics.dto';

@ApiTags('Public')
@Public()
@Controller('public/events')
export class PublicEventsController {
  constructor(private readonly ingest: AnalyticsIngestService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @UseThrottleProfile('events')
  @ApiOperation({
    summary: 'Record anonymous wallpaper events',
    description: `Batch of 1-${MAX_EVENTS_PER_BATCH} events. Only published wallpapers are counted; repeats from the same client within a short window are ignored. No personal data is stored. Events are recorded asynchronously (within a few seconds).`,
  })
  @ApiAcceptedResponse({ type: TrackEventsResultDto, schema: { example: { data: { accepted: 2, duplicates: 0, rejected: 0 } } } })
  @ApiValidationError()
  @ApiTooManyRequests()
  track(@Body() dto: TrackEventsDto, @Req() req: Request): Promise<TrackEventsResultDto> {
    return this.ingest.track(dto, req.ip);
  }
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { ClientPlatform, WallpaperEventType } from '../../../generated/prisma/enums';

export const MAX_EVENTS_PER_BATCH = 50;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class WallpaperEventDto {
  @ApiProperty({ format: 'uuid', example: '01928c1e-0000-7000-8000-00000000a001' })
  @IsUUID()
  wallpaperId: string;

  @ApiProperty({
    enum: WallpaperEventType,
    description:
      'WALLPAPER_VIEW: detail screen opened. WALLPAPER_DOWNLOAD_CLICK: download tapped. WALLPAPER_DOWNLOAD: file saved / applied successfully.',
  })
  @IsEnum(WallpaperEventType)
  type: WallpaperEventType;

  @ApiPropertyOptional({ enum: ClientPlatform })
  @IsOptional()
  @IsEnum(ClientPlatform)
  platform?: ClientPlatform;

  @ApiPropertyOptional({ example: '1.4.2' })
  @IsOptional()
  @Matches(/^\d{1,4}\.\d{1,4}\.\d{1,4}$/, { message: 'appVersion must be MAJOR.MINOR.PATCH' })
  appVersion?: string;
}

export class TrackEventsDto {
  @ApiProperty({ type: [WallpaperEventDto], maxItems: MAX_EVENTS_PER_BATCH, minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_EVENTS_PER_BATCH)
  @ValidateNested({ each: true })
  @Type(() => WallpaperEventDto)
  events: WallpaperEventDto[];
}

export class TrackEventsResultDto {
  @ApiProperty({ description: 'Events queued for recording' }) accepted: number;
  @ApiProperty({ description: 'Events ignored as repeats within the dedupe window' }) duplicates: number;
  @ApiProperty({ description: 'Events referencing unknown or unpublished wallpapers' }) rejected: number;
}

export class DateRangeQueryDto {
  @ApiPropertyOptional({ example: '2026-01-01', description: 'Inclusive UTC date. Defaults to 29 days before `to`.' })
  @IsOptional()
  @Matches(ISO_DATE, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-01-31', description: 'Inclusive UTC date. Defaults to today.' })
  @IsOptional()
  @Matches(ISO_DATE, { message: 'to must be YYYY-MM-DD' })
  to?: string;
}

export const ANALYTICS_METRICS = ['views', 'downloadClicks', 'downloads'] as const;
export type AnalyticsMetric = (typeof ANALYTICS_METRICS)[number];

export class PopularQueryDto extends DateRangeQueryDto {
  @ApiPropertyOptional({ enum: ANALYTICS_METRICS, default: 'downloads' })
  @IsOptional()
  @IsIn(ANALYTICS_METRICS)
  metric: AnalyticsMetric = 'downloads';

  @ApiPropertyOptional({ default: 10, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 10;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { CONTENT_LOCALES, ContentLocale } from '../../../common/i18n/content-locale';
import { SLUG_PATTERN } from '../../../common/utils/slug.util';
import { ClientPlatform, WallpaperOrientation } from '../../../generated/prisma/enums';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export enum PublicWallpaperSort {
  Latest = 'latest',
  Popular = 'popular',
  Downloads = 'downloads',
  Featured = 'featured',
  Manual = 'manual',
  Random = 'random',
}

export class PublicLocaleQueryDto {
  @ApiPropertyOptional({
    enum: CONTENT_LOCALES,
    description: 'Overrides Accept-Language. Unsupported values are rejected. When omitted, Accept-Language is used, then English.',
  })
  @IsOptional()
  @IsIn(CONTENT_LOCALES)
  lang?: ContentLocale;
}

class PublicWallpaperFiltersDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ example: 'nature' })
  @IsOptional()
  @Matches(SLUG_PATTERN)
  @MaxLength(120)
  categorySlug?: string;

  @ApiPropertyOptional({ enum: WallpaperOrientation })
  @IsOptional()
  @IsEnum(WallpaperOrientation)
  orientation?: WallpaperOrientation;

  @ApiPropertyOptional({ enum: PublicWallpaperSort, default: PublicWallpaperSort.Latest })
  @IsOptional()
  @IsEnum(PublicWallpaperSort)
  sort: PublicWallpaperSort = PublicWallpaperSort.Latest;

  @ApiPropertyOptional({
    description: 'Stable session key for sort=random. Reuse the same seed while paging. A new seed starts a new order. 8-64 letters, digits, _ or -.',
    example: 'a1b2c3d4e5f67890',
  })
  @IsOptional()
  @Matches(/^[A-Za-z0-9_-]{8,64}$/)
  seed?: string;

  @ApiPropertyOptional({ enum: CONTENT_LOCALES })
  @IsOptional()
  @IsIn(CONTENT_LOCALES)
  lang?: ContentLocale;
}

export class PublicWallpapersQueryDto extends PublicWallpaperFiltersDto {
  @ApiPropertyOptional({ description: 'Optional keyword filter', example: 'mountain' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  q?: string;
}

export class PublicSearchQueryDto extends PublicWallpaperFiltersDto {
  @ApiProperty({ example: 'mountain', minLength: 2, maxLength: 100 })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  q: string;
}

export class PublicListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: CONTENT_LOCALES })
  @IsOptional()
  @IsIn(CONTENT_LOCALES)
  lang?: ContentLocale;
}

export class PublicFeedQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: WallpaperOrientation })
  @IsOptional()
  @IsEnum(WallpaperOrientation)
  orientation?: WallpaperOrientation;

  @ApiPropertyOptional({ enum: CONTENT_LOCALES })
  @IsOptional()
  @IsIn(CONTENT_LOCALES)
  lang?: ContentLocale;
}

export class AppConfigQueryDto {
  @ApiPropertyOptional({ enum: ClientPlatform, description: 'Enables the computed `updateStatus` field' })
  @IsOptional()
  @IsIn(Object.values(ClientPlatform))
  platform?: ClientPlatform;

  @ApiPropertyOptional({ example: '1.4.2' })
  @IsOptional()
  @Matches(/^\d{1,4}\.\d{1,4}\.\d{1,4}$/, { message: 'appVersion must be MAJOR.MINOR.PATCH' })
  appVersion?: string;

  @ApiPropertyOptional({ enum: CONTENT_LOCALES })
  @IsOptional()
  @IsIn(CONTENT_LOCALES)
  lang?: ContentLocale;
}

export class PublicWallpaperSummaryDto {
  @ApiProperty({ format: 'uuid', example: '01928c1e-0000-7000-8000-00000000a001' }) id: string;
  @ApiProperty({ example: 'Mountain Wallpaper' }) title: string;
  @ApiProperty({ example: 'mountain-wallpaper' }) slug: string;
  @ApiProperty({ example: 'https://cdn.example.com/media/2026/01/x/thumbnail.webp' }) thumbnailUrl: string;
  @ApiProperty({ example: 'https://cdn.example.com/media/2026/01/x/preview.webp' }) previewUrl: string;
  @ApiProperty({ example: 1440 }) width: number;
  @ApiProperty({ example: 3200 }) height: number;
  @ApiProperty({ enum: WallpaperOrientation }) orientation: WallpaperOrientation;
  @ApiProperty() isFeatured: boolean;
}

export class PublicCategoryRefDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiProperty() slug: string;
}

export class PublicWallpaperDetailDto extends PublicWallpaperSummaryDto {
  @ApiProperty({ nullable: true, type: String }) description: string | null;
  @ApiProperty({ type: [String] }) tags: string[];
  @ApiProperty({ type: [PublicCategoryRefDto] }) categories: PublicCategoryRefDto[];
  @ApiProperty({ nullable: true, type: String, description: 'Full-resolution URL; null when downloads are disabled' })
  downloadUrl: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) publishedAt: Date | null;
}

export class PublicCategoryDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiProperty() slug: string;
  @ApiProperty({ nullable: true, type: String }) description: string | null;
  @ApiProperty({ nullable: true, type: String }) thumbnailUrl: string | null;
  @ApiProperty({ nullable: true, type: String }) previewUrl: string | null;
  @ApiProperty({ description: 'Number of published wallpapers' }) wallpaperCount: number;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { HomeSectionType, WallpaperOrientation } from '../../../generated/prisma/enums';
import { CONTENT_LOCALES, ContentLocale } from '../../../common/i18n/content-locale';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export const CONFIG_EXAMPLES: Record<HomeSectionType, Record<string, unknown>> = {
  BANNERS: { limit: 5 },
  FEATURED_WALLPAPERS: { limit: 10, orientation: 'PORTRAIT' },
  POPULAR_WALLPAPERS: { limit: 10 },
  LATEST_WALLPAPERS: { limit: 10 },
  CATEGORY_WALLPAPERS: { categoryId: '01928c1e-0000-7000-8000-00000000c001', limit: 10, sort: 'latest' },
  CUSTOM_WALLPAPERS: { wallpaperIds: ['01928c1e-0000-7000-8000-00000000a001'] },
  CATEGORIES: { categoryIds: null, limit: 12 },
};

export class HomeSectionTranslationInputDto {
  @ApiProperty({ enum: CONTENT_LOCALES })
  @IsIn(CONTENT_LOCALES)
  locale!: ContentLocale;

  @ApiProperty({ maxLength: 120 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title!: string;
}

export class CreateHomeSectionDto {
  @ApiProperty({ example: 'Featured' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title: string;

  @ApiProperty({ enum: HomeSectionType, example: HomeSectionType.FEATURED_WALLPAPERS })
  @IsEnum(HomeSectionType)
  sectionType: HomeSectionType;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Defaults to the end of the list' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  sortOrder?: number;

  @ApiPropertyOptional({
    description: 'Type-specific configuration (validated per sectionType).',
    example: CONFIG_EXAMPLES.CATEGORY_WALLPAPERS,
  })
  @IsOptional()
  @IsObject()
  configuration?: Record<string, unknown>;

  @ApiPropertyOptional({ type: [HomeSectionTranslationInputDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => HomeSectionTranslationInputDto)
  translations?: HomeSectionTranslationInputDto[];
}

export class UpdateHomeSectionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title?: string;

  @ApiPropertyOptional({ enum: HomeSectionType, description: 'Changing the type requires a valid configuration for the new type' })
  @IsOptional()
  @IsEnum(HomeSectionType)
  sectionType?: HomeSectionType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  sortOrder?: number;

  @ApiPropertyOptional({ description: 'Replaces the whole configuration' })
  @IsOptional()
  @IsObject()
  configuration?: Record<string, unknown>;

  @ApiPropertyOptional({ type: [HomeSectionTranslationInputDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => HomeSectionTranslationInputDto)
  translations?: HomeSectionTranslationInputDto[];
}

// ---- Per-type configuration schemas ----

export class LimitConfig {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class FeedConfig extends LimitConfig {
  @IsOptional()
  @IsEnum(WallpaperOrientation)
  orientation?: WallpaperOrientation;
}

export const CATEGORY_SECTION_SORTS = ['latest', 'popular', 'manual'] as const;
export type CategorySectionSort = (typeof CATEGORY_SECTION_SORTS)[number];

export class CategoryWallpapersConfig extends FeedConfig {
  @IsUUID()
  categoryId: string;

  @IsOptional()
  @IsIn(CATEGORY_SECTION_SORTS)
  sort?: CategorySectionSort;
}

export class CustomWallpapersConfig {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  wallpaperIds: string[];
}

export class CategoriesConfig extends LimitConfig {
  /** null/absent = all published categories in manual order. */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  categoryIds?: string[] | null;
}

export const CONFIG_CLASSES = {
  BANNERS: LimitConfig,
  FEATURED_WALLPAPERS: FeedConfig,
  POPULAR_WALLPAPERS: FeedConfig,
  LATEST_WALLPAPERS: FeedConfig,
  CATEGORY_WALLPAPERS: CategoryWallpapersConfig,
  CUSTOM_WALLPAPERS: CustomWallpapersConfig,
  CATEGORIES: CategoriesConfig,
} satisfies Record<HomeSectionType, new () => object>;

export type HomeSectionConfig =
  | LimitConfig
  | FeedConfig
  | CategoryWallpapersConfig
  | CustomWallpapersConfig
  | CategoriesConfig;

export class HomeSectionResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() title: string;
  @ApiProperty({ enum: HomeSectionType }) sectionType: HomeSectionType;
  @ApiProperty() sortOrder: number;
  @ApiProperty() isEnabled: boolean;
  @ApiProperty({ type: 'object', additionalProperties: true }) configuration: Record<string, unknown>;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt: Date;
  @ApiProperty({ type: 'array', items: { type: 'object' } })
  translations?: { locale: string; title: string }[];
}

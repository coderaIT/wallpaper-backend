import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { SortDirection } from '../../../common/dto/sort.dto';
import { CONTENT_LOCALES, ContentLocale } from '../../../common/i18n/content-locale';
import { SLUG_PATTERN } from '../../../common/utils/slug.util';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const toBool = ({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value);

export class CategoryTranslationInputDto {
  @ApiProperty({ enum: CONTENT_LOCALES, example: 'ar' })
  @IsIn(CONTENT_LOCALES)
  locale!: ContentLocale;

  @ApiProperty({ example: 'طبيعة', maxLength: 100 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ example: 'خلفيات طبيعية', nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  description?: string | null;
}

export class CategoryTranslationDto {
  @ApiProperty({ enum: CONTENT_LOCALES }) locale!: ContentLocale;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true, type: String }) description!: string | null;
}

export class CreateCategoryDto {
  @ApiProperty({ example: 'Nature', maxLength: 100 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ example: 'nature', description: 'Generated from name when omitted' })
  @IsOptional()
  @Transform(trim)
  @Matches(SLUG_PATTERN, { message: 'slug must contain only lower-case letters, digits and single hyphens' })
  @MaxLength(120)
  slug?: string;

  @ApiPropertyOptional({ example: 'Mountains, forests and oceans', nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, description: 'Existing media id to use as cover' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  coverMediaId?: string | null;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;

  @ApiPropertyOptional({ description: 'Defaults to the end of the list' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  sortOrder?: number;

  @ApiPropertyOptional({
    type: [CategoryTranslationInputDto],
    description: 'Arabic, Turkish, and English copy for the same category. When omitted, name/description are stored as the English translation.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => CategoryTranslationInputDto)
  translations?: CategoryTranslationInputDto[];
}

export class UpdateCategoryDto {
  @ApiPropertyOptional({ example: 'Nature & Landscapes' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: 'nature-landscapes' })
  @IsOptional()
  @Transform(trim)
  @Matches(SLUG_PATTERN, { message: 'slug must contain only lower-case letters, digits and single hyphens' })
  @MaxLength(120)
  slug?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  sortOrder?: number;

  @ApiPropertyOptional({
    type: [CategoryTranslationInputDto],
    description: 'Replaces the full translation set. Omit this field to leave translations unchanged, except a legacy name/description write which upserts English.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => CategoryTranslationInputDto)
  translations?: CategoryTranslationInputDto[];
}

export class SetCategoryCoverDto {
  @ApiProperty({ format: 'uuid', nullable: true, description: 'Media id, or null to remove the cover' })
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  mediaId: string | null;
}

export enum CategorySortField {
  SortOrder = 'sortOrder',
  Name = 'name',
  CreatedAt = 'createdAt',
  WallpaperCount = 'wallpaperCount',
}

export class ListCategoriesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Search in name and slug' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isPublished?: boolean;

  @ApiPropertyOptional({ enum: CategorySortField, default: CategorySortField.SortOrder })
  @IsOptional()
  @IsEnum(CategorySortField)
  sortBy: CategorySortField = CategorySortField.SortOrder;

  @ApiPropertyOptional({ enum: SortDirection, default: SortDirection.Asc })
  @IsOptional()
  @IsEnum(SortDirection)
  sortDir: SortDirection = SortDirection.Asc;
}

export class CoverDto {
  @ApiProperty({ format: 'uuid' }) mediaId: string;
  @ApiProperty() thumbnailUrl: string;
  @ApiProperty() previewUrl: string;
  @ApiProperty() originalUrl: string;
}

export class DeleteCategoryQueryDto {
  @ApiPropertyOptional({
    default: false,
    description: 'Also delete wallpapers that belong only to this category. Wallpapers shared with other categories are kept.',
  })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  deleteExclusiveWallpapers: boolean = false;
}

export class CategoryDeletionImpactDto {
  @ApiProperty({ format: 'uuid' }) categoryId!: string;
  @ApiProperty() associatedWallpapers!: number;
  @ApiProperty() exclusiveWallpapers!: number;
  @ApiProperty() sharedWallpapers!: number;
  @ApiProperty({ description: 'Original media of exclusive wallpapers that is not referenced elsewhere' })
  mediaEligibleForCleanup!: number;
}

export class CategoryResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ description: 'Legacy/default name. English when an English translation exists, otherwise the originally stored name.' })
  name: string;
  @ApiProperty() slug: string;
  @ApiProperty({ nullable: true, type: String }) description: string | null;
  @ApiProperty({ type: [CategoryTranslationDto] }) translations!: CategoryTranslationDto[];
  @ApiProperty() sortOrder: number;
  @ApiProperty() isPublished: boolean;
  @ApiProperty({ type: CoverDto, nullable: true }) cover: CoverDto | null;
  @ApiProperty({ description: 'All wallpapers in the category' }) wallpaperCount: number;
  @ApiProperty({ description: 'Published wallpapers in the category' }) publishedWallpaperCount: number;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt: Date;
}

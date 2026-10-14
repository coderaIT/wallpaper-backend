import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
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
import { ReorderItemDto } from '../../../common/dto/reorder.dto';
import { SortDirection } from '../../../common/dto/sort.dto';
import { CONTENT_LOCALES, ContentLocale } from '../../../common/i18n/content-locale';
import { SLUG_PATTERN } from '../../../common/utils/slug.util';
import { WallpaperOrientation } from '../../../generated/prisma/enums';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const toBool = ({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value);
const normalizeTags = ({ value }: { value: unknown }) =>
  Array.isArray(value)
    ? [...new Set(value.map((t) => (typeof t === 'string' ? t.trim().toLowerCase() : t)))]
    : value;

export const TAG_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} _-]{0,39}$/u;

export class WallpaperTranslationInputDto {
  @ApiProperty({ enum: CONTENT_LOCALES })
  @IsIn(CONTENT_LOCALES)
  locale!: ContentLocale;

  @ApiProperty({ maxLength: 150 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  title!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  description?: string | null;
}

export class WallpaperTranslationDto {
  @ApiProperty({ enum: CONTENT_LOCALES }) locale!: ContentLocale;
  @ApiProperty() title!: string;
  @ApiProperty({ nullable: true, type: String }) description!: string | null;
}

export class CreateWallpaperDto {
  @ApiProperty({ example: 'Mountain Sunrise', maxLength: 150 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  title: string;

  @ApiPropertyOptional({ example: 'Golden light over the Alps', nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional({ example: 'mountain-sunrise', description: 'Generated from title when omitted' })
  @IsOptional()
  @Matches(SLUG_PATTERN, { message: 'slug must contain only lower-case letters, digits and single hyphens' })
  @MaxLength(180)
  slug?: string;

  @ApiProperty({ format: 'uuid', description: 'Uploaded media id (POST /admin/media)' })
  @IsUUID()
  mediaId: string;

  @ApiPropertyOptional({ type: [String], format: 'uuid', example: ['01928c1e-0000-7000-8000-00000000c001'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  categoryIds?: string[];

  @ApiPropertyOptional({ type: [String], example: ['mountain', 'sunrise'] })
  @IsOptional()
  @Transform(normalizeTags)
  @IsArray()
  @ArrayMaxSize(30)
  @Matches(TAG_PATTERN, { each: true, message: 'each tag must be 1-40 letters, digits, spaces, _ or -' })
  tags?: string[];

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  sortOrder?: number;

  @ApiPropertyOptional({ type: [WallpaperTranslationInputDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => WallpaperTranslationInputDto)
  translations?: WallpaperTranslationInputDto[];
}

export class UpdateWallpaperDto {
  @ApiPropertyOptional({ example: 'Mountain Sunrise (HD)' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  title?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(SLUG_PATTERN, { message: 'slug must contain only lower-case letters, digits and single hyphens' })
  @MaxLength(180)
  slug?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Replace the image (dimensions/orientation are recomputed)' })
  @IsOptional()
  @IsUUID()
  mediaId?: string;

  @ApiPropertyOptional({ type: [String], description: 'Replaces ALL category assignments ([] removes all)' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  categoryIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @Transform(normalizeTags)
  @IsArray()
  @ArrayMaxSize(30)
  @Matches(TAG_PATTERN, { each: true, message: 'each tag must be 1-40 letters, digits, spaces, _ or -' })
  tags?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

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

  @ApiPropertyOptional({ type: [WallpaperTranslationInputDto], description: 'Replaces the translation set when present' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => WallpaperTranslationInputDto)
  translations?: WallpaperTranslationInputDto[];
}

export class PublishWallpaperDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  isPublished: boolean;
}

export class BulkCreateItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  mediaId: string;

  @ApiPropertyOptional({ description: 'Defaults to the media file name' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @Transform(normalizeTags)
  @IsArray()
  @ArrayMaxSize(30)
  @Matches(TAG_PATTERN, { each: true })
  tags?: string[];
}

export class BulkCreateWallpapersDto {
  @ApiProperty({ type: [BulkCreateItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => BulkCreateItemDto)
  items: BulkCreateItemDto[];

  @ApiPropertyOptional({ type: [String], description: 'Categories applied to every created wallpaper' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  categoryIds?: string[];

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;
}

export enum BulkWallpaperAction {
  Publish = 'PUBLISH',
  Unpublish = 'UNPUBLISH',
  Feature = 'FEATURE',
  Unfeature = 'UNFEATURE',
  AddCategories = 'ADD_CATEGORIES',
  RemoveCategories = 'REMOVE_CATEGORIES',
  Reorder = 'REORDER',
  Delete = 'DELETE',
}

export class BulkUpdateWallpapersDto {
  @ApiProperty({ enum: BulkWallpaperAction, example: BulkWallpaperAction.Publish })
  @IsEnum(BulkWallpaperAction)
  action: BulkWallpaperAction;

  @ApiPropertyOptional({ type: [String], description: 'Target wallpaper ids (all actions except REORDER)' })
  @ValidateIf((o: BulkUpdateWallpapersDto) => o.action !== BulkWallpaperAction.Reorder)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  ids?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Required for ADD_CATEGORIES / REMOVE_CATEGORIES' })
  @ValidateIf(
    (o: BulkUpdateWallpapersDto) =>
      o.action === BulkWallpaperAction.AddCategories || o.action === BulkWallpaperAction.RemoveCategories,
  )
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  categoryIds?: string[];

  @ApiPropertyOptional({ type: [ReorderItemDto], description: 'Required for REORDER' })
  @ValidateIf((o: BulkUpdateWallpapersDto) => o.action === BulkWallpaperAction.Reorder)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ReorderItemDto)
  items?: ReorderItemDto[];
}

export class DeleteWallpaperQueryDto {
  @ApiPropertyOptional({ default: false, description: 'Also delete the image if no longer used anywhere' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  deleteMedia: boolean = false;
}

export enum WallpaperSortField {
  CreatedAt = 'createdAt',
  PublishedAt = 'publishedAt',
  Popularity = 'popularity',
  Downloads = 'downloads',
  Views = 'views',
  SortOrder = 'sortOrder',
  Title = 'title',
}

export class ListWallpapersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Search title, description and tags' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ description: 'Only wallpapers without any category' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  uncategorized?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isPublished?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isFeatured?: boolean;

  @ApiPropertyOptional({ enum: WallpaperOrientation })
  @IsOptional()
  @IsEnum(WallpaperOrientation)
  orientation?: WallpaperOrientation;

  @ApiPropertyOptional({ enum: WallpaperSortField, default: WallpaperSortField.CreatedAt })
  @IsOptional()
  @IsEnum(WallpaperSortField)
  sortBy: WallpaperSortField = WallpaperSortField.CreatedAt;

  @ApiPropertyOptional({ enum: SortDirection, default: SortDirection.Desc })
  @IsOptional()
  @IsEnum(SortDirection)
  sortDir: SortDirection = SortDirection.Desc;
}

/** Multipart form fields accompanying POST /admin/wallpapers/upload (all strings in multipart). */
export class UploadWallpapersFormDto {
  @ApiPropertyOptional({ description: 'Comma-separated category ids', example: '01928c1e-0000-7000-8000-00000000c001' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.split(',').map((s) => s.trim()).filter(Boolean) : value,
  )
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  categoryIds?: string[];

  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isPublished?: boolean;

  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isFeatured?: boolean;
}

export class WallpaperImageDto {
  @ApiProperty({ format: 'uuid' }) mediaId: string;
  @ApiProperty() thumbnailUrl: string;
  @ApiProperty() previewUrl: string;
  @ApiProperty() originalUrl: string;
}

export class WallpaperCategoryRefDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiProperty() slug: string;
}

export class WallpaperStatsDto {
  @ApiProperty() views: number;
  @ApiProperty() downloadClicks: number;
  @ApiProperty() downloads: number;
}

export class WallpaperAdminResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() title: string;
  @ApiProperty({ nullable: true, type: String }) description: string | null;
  @ApiProperty({ type: [WallpaperTranslationDto] }) translations!: WallpaperTranslationDto[];
  @ApiProperty() slug: string;
  @ApiProperty({ type: [String] }) tags: string[];
  @ApiProperty({ enum: WallpaperOrientation }) orientation: WallpaperOrientation;
  @ApiProperty() width: number;
  @ApiProperty() height: number;
  @ApiProperty() isFeatured: boolean;
  @ApiProperty() isPublished: boolean;
  @ApiProperty() sortOrder: number;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) publishedAt: Date | null;
  @ApiProperty({ type: WallpaperImageDto }) image: WallpaperImageDto;
  @ApiProperty({ type: [WallpaperCategoryRefDto] }) categories: WallpaperCategoryRefDto[];
  @ApiProperty({ type: WallpaperStatsDto }) stats: WallpaperStatsDto;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt: Date;
}

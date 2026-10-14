import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { CONTENT_LOCALES, ContentLocale } from '../../../common/i18n/content-locale';
import { BannerActionType } from '../../../generated/prisma/enums';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const toBool = ({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value);

export class BannerTranslationInputDto {
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
  @MaxLength(300)
  subtitle?: string | null;
}

export class CreateBannerDto {
  @ApiProperty({ example: 'Summer collection' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  title: string;

  @ApiPropertyOptional({ example: '50 new wallpapers', nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  subtitle?: string | null;

  @ApiProperty({ format: 'uuid', description: 'Media id uploaded via POST /admin/media' })
  @IsUUID()
  imageMediaId: string;

  @ApiProperty({ enum: BannerActionType, example: BannerActionType.OPEN_CATEGORY })
  @IsEnum(BannerActionType)
  actionType: BannerActionType;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Wallpaper id (OPEN_WALLPAPER), category id (OPEN_CATEGORY), https URL (OPEN_URL); null for NONE',
    example: '01928c1e-0000-7000-8000-00000000c001',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(2048)
  actionValue?: string | null;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  sortOrder?: number;

  @ApiPropertyOptional({ nullable: true, example: '2026-06-01T00:00:00.000Z' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsISO8601({ strict: true })
  startsAt?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '2026-09-01T00:00:00.000Z' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsISO8601({ strict: true })
  endsAt?: string | null;

  @ApiPropertyOptional({ type: [BannerTranslationInputDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => BannerTranslationInputDto)
  translations?: BannerTranslationInputDto[];
}

export class UpdateBannerDto {
  @ApiPropertyOptional()
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
  @MaxLength(300)
  subtitle?: string | null;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  imageMediaId?: string;

  @ApiPropertyOptional({ enum: BannerActionType })
  @IsOptional()
  @IsEnum(BannerActionType)
  actionType?: BannerActionType;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(2048)
  actionValue?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  sortOrder?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsISO8601({ strict: true })
  startsAt?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsISO8601({ strict: true })
  endsAt?: string | null;

  @ApiPropertyOptional({ type: [BannerTranslationInputDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => BannerTranslationInputDto)
  translations?: BannerTranslationInputDto[];
}

export class ListBannersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isActive?: boolean;
}

export class BannerResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() title: string;
  @ApiProperty({ nullable: true, type: String }) subtitle: string | null;
  @ApiProperty({ enum: BannerActionType }) actionType: BannerActionType;
  @ApiProperty({ nullable: true, type: String }) actionValue: string | null;
  @ApiProperty() sortOrder: number;
  @ApiProperty() isActive: boolean;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) startsAt: Date | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) endsAt: Date | null;
  @ApiProperty({ example: { mediaId: '...', thumbnailUrl: '...', previewUrl: '...', originalUrl: '...' } })
  image: { mediaId: string; thumbnailUrl: string; previewUrl: string; originalUrl: string };
  @ApiProperty({ type: 'array', items: { type: 'object' } })
  translations!: { locale: ContentLocale; title: string; subtitle: string | null }[];
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt: Date;
}

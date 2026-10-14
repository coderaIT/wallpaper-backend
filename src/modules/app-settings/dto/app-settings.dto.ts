import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { IsBooleanRecord, IsSafeExternalUrl } from '../../../common/validators/safe-url.validator';
import { CONTENT_LOCALES, ContentLocale } from '../../../common/i18n/content-locale';

export const SEMVER_PATTERN = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;

/*
 * Full, typed application configuration document. Every field is required here: the
 * stored document is always complete (defaults are merged in), and the merged result of
 * every PATCH is re-validated against these classes before saving.
 * `ValidateIf(v !== null)` marks nullable fields.
 */

export class MaintenanceSettingsDto {
  @ApiProperty({ example: false })
  @IsBoolean()
  enabled: boolean;

  @ApiProperty({ example: 'We will be back soon' })
  @IsString()
  @MaxLength(120)
  title: string;

  @ApiProperty({ example: 'Scheduled maintenance is in progress.' })
  @IsString()
  @MaxLength(1000)
  message: string;

  @ApiProperty({ nullable: true, example: null, description: 'ISO-8601 timestamp' })
  @ValidateIf((_, v) => v !== null)
  @IsISO8601({ strict: true })
  estimatedEndAt: string | null;
}

export class PlatformVersionPolicyDto {
  @ApiProperty({ example: '1.0.0', description: 'Apps below this version must update' })
  @Matches(SEMVER_PATTERN, { message: 'minSupportedVersion must be a MAJOR.MINOR.PATCH version' })
  minSupportedVersion: string;

  @ApiProperty({ example: '1.2.0' })
  @Matches(SEMVER_PATTERN, { message: 'latestVersion must be a MAJOR.MINOR.PATCH version' })
  latestVersion: string;

  @ApiProperty({ example: 'Please update the app to keep using it.' })
  @IsString()
  @MaxLength(500)
  updateRequiredMessage: string;

  @ApiProperty({ example: 'A new version is available.' })
  @IsString()
  @MaxLength(500)
  updateAvailableMessage: string;

  @ApiProperty({ nullable: true, example: 'https://play.google.com/store/apps/details?id=com.example.wallpapers' })
  @ValidateIf((_, v) => v !== null)
  @IsSafeExternalUrl()
  storeUrl: string | null;
}

export class AppUpdateSettingsDto {
  @ApiProperty({ type: PlatformVersionPolicyDto })
  @ValidateNested()
  @Type(() => PlatformVersionPolicyDto)
  android: PlatformVersionPolicyDto;

  @ApiProperty({ type: PlatformVersionPolicyDto })
  @ValidateNested()
  @Type(() => PlatformVersionPolicyDto)
  ios: PlatformVersionPolicyDto;
}

export const ANNOUNCEMENT_LEVELS = ['INFO', 'WARNING', 'PROMO'] as const;

export class AnnouncementTranslationDto {
  @ApiProperty({ enum: CONTENT_LOCALES })
  @IsIn(CONTENT_LOCALES)
  locale!: ContentLocale;

  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MaxLength(120)
  title!: string;

  @ApiProperty({ maxLength: 1000 })
  @IsString()
  @MaxLength(1000)
  message!: string;
}

export class AnnouncementDto {
  @ApiProperty({ example: 'summer-2026', description: 'Stable id so the app can remember dismissals' })
  @Matches(/^[a-z0-9][a-z0-9-]{0,63}$/, { message: 'id must be a lower-case slug (max 64 chars)' })
  id: string;

  @ApiProperty({ example: 'New collection!' })
  @IsString()
  @MaxLength(120)
  title: string;

  @ApiProperty({ example: 'Check out 50 new summer wallpapers.' })
  @IsString()
  @MaxLength(1000)
  message: string;

  @ApiProperty({ enum: ANNOUNCEMENT_LEVELS, example: 'INFO' })
  @IsIn(ANNOUNCEMENT_LEVELS)
  level: (typeof ANNOUNCEMENT_LEVELS)[number];

  @ApiProperty({ nullable: true, example: null })
  @ValidateIf((_, v) => v !== null)
  @IsSafeExternalUrl()
  actionUrl: string | null;

  @ApiProperty({ example: true })
  @IsBoolean()
  dismissible: boolean;

  @ApiProperty({ example: true })
  @IsBoolean()
  isActive: boolean;

  @ApiProperty({ nullable: true, example: null })
  @ValidateIf((_, v) => v !== null)
  @IsISO8601({ strict: true })
  startsAt: string | null;

  @ApiProperty({ nullable: true, example: null })
  @ValidateIf((_, v) => v !== null)
  @IsISO8601({ strict: true })
  endsAt: string | null;

  @ApiPropertyOptional({ type: [AnnouncementTranslationDto], description: 'Optional Arabic, Turkish, and English copy. title/message remain the fallback.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => AnnouncementTranslationDto)
  translations?: AnnouncementTranslationDto[];
}

export class HomeSettingsDto {
  @ApiProperty({ example: true, description: 'Master switch for the banner carousel' })
  @IsBoolean()
  bannersEnabled: boolean;

  @ApiProperty({ example: 10, minimum: 1, maximum: 50 })
  @IsInt()
  @Min(1)
  @Max(50)
  defaultSectionLimit: number;
}

export class DownloadSettingsDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  enabled: boolean;

  @ApiProperty({ example: true, description: 'Expose full-resolution original download URLs' })
  @IsBoolean()
  allowOriginalDownload: boolean;

  @ApiProperty({ example: 'Downloads are temporarily unavailable.' })
  @IsString()
  @MaxLength(300)
  disabledMessage: string;
}

export class ExternalLinkDto {
  @ApiProperty({ example: 'instagram' })
  @Matches(/^[a-z0-9][a-z0-9_-]{0,31}$/, { message: 'key must be a lower-case identifier' })
  key: string;

  @ApiProperty({ example: 'Instagram' })
  @IsString()
  @MaxLength(60)
  label: string;

  @ApiProperty({ example: 'https://instagram.com/example' })
  @IsSafeExternalUrl()
  url: string;
}

export class ExternalLinksSettingsDto {
  @ApiProperty({ nullable: true, example: 'https://example.com/privacy' })
  @ValidateIf((_, v) => v !== null)
  @IsSafeExternalUrl()
  privacyPolicyUrl: string | null;

  @ApiProperty({ nullable: true, example: 'https://example.com/terms' })
  @ValidateIf((_, v) => v !== null)
  @IsSafeExternalUrl()
  termsOfServiceUrl: string | null;

  @ApiProperty({ nullable: true, example: 'support@example.com' })
  @ValidateIf((_, v) => v !== null)
  @IsEmail()
  supportEmail: string | null;

  @ApiProperty({ nullable: true, example: 'https://example.com' })
  @ValidateIf((_, v) => v !== null)
  @IsSafeExternalUrl()
  websiteUrl: string | null;

  @ApiProperty({ type: [ExternalLinkDto] })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ExternalLinkDto)
  links: ExternalLinkDto[];
}

export class AppSettingsDto {
  @ApiProperty({ type: MaintenanceSettingsDto })
  @ValidateNested()
  @Type(() => MaintenanceSettingsDto)
  maintenance: MaintenanceSettingsDto;

  @ApiProperty({ type: AppUpdateSettingsDto })
  @ValidateNested()
  @Type(() => AppUpdateSettingsDto)
  appUpdate: AppUpdateSettingsDto;

  @ApiProperty({ type: [AnnouncementDto] })
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => AnnouncementDto)
  announcements: AnnouncementDto[];

  @ApiProperty({ type: HomeSettingsDto })
  @ValidateNested()
  @Type(() => HomeSettingsDto)
  home: HomeSettingsDto;

  @ApiProperty({ type: DownloadSettingsDto })
  @ValidateNested()
  @Type(() => DownloadSettingsDto)
  downloads: DownloadSettingsDto;

  @ApiProperty({ type: ExternalLinksSettingsDto })
  @ValidateNested()
  @Type(() => ExternalLinksSettingsDto)
  externalLinks: ExternalLinksSettingsDto;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'boolean' },
    example: { newEditor: false, aiSearch: false },
    description: 'Typed boolean flags for optional/future features',
  })
  @IsObject()
  @IsBooleanRecord()
  featureFlags: Record<string, boolean>;
}

/**
 * PATCH body. Each top-level group is optional and may itself be partial; the service deep-
 * merges it onto the stored document (arrays are replaced wholesale) and validates the
 * merged result with {@link AppSettingsDto}. Unknown keys are rejected during that validation.
 */
export class UpdateAppSettingsDto {
  @ApiPropertyOptional({ description: 'Optimistic concurrency: reject if the stored version differs', example: 3 })
  @IsOptional()
  @IsInt()
  @Min(1)
  expectedVersion?: number;

  @ApiPropertyOptional({ type: MaintenanceSettingsDto, example: { enabled: true, message: 'Back at 18:00 UTC' } })
  @IsOptional()
  @IsObject()
  maintenance?: Partial<MaintenanceSettingsDto>;

  @ApiPropertyOptional({ type: AppUpdateSettingsDto, example: { android: { minSupportedVersion: '1.2.0' } } })
  @IsOptional()
  @IsObject()
  appUpdate?: { android?: Partial<PlatformVersionPolicyDto>; ios?: Partial<PlatformVersionPolicyDto> };

  @ApiPropertyOptional({ type: [AnnouncementDto] })
  @IsOptional()
  @IsArray()
  announcements?: AnnouncementDto[];

  @ApiPropertyOptional({ type: HomeSettingsDto })
  @IsOptional()
  @IsObject()
  home?: Partial<HomeSettingsDto>;

  @ApiPropertyOptional({ type: DownloadSettingsDto })
  @IsOptional()
  @IsObject()
  downloads?: Partial<DownloadSettingsDto>;

  @ApiPropertyOptional({ type: ExternalLinksSettingsDto })
  @IsOptional()
  @IsObject()
  externalLinks?: Partial<ExternalLinksSettingsDto>;

  @ApiPropertyOptional({ type: 'object', additionalProperties: { type: 'boolean' } })
  @IsOptional()
  @IsObject()
  featureFlags?: Record<string, boolean>;
}

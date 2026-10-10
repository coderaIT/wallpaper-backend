import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

const toBool = ({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value);

export class ListMediaQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Only media not referenced by any wallpaper, category or banner' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  unused?: boolean;

  @ApiPropertyOptional({ description: 'Search by original file name' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: ['image/jpeg', 'image/png', 'image/webp'] })
  @IsOptional()
  @IsIn(['image/jpeg', 'image/png', 'image/webp'])
  mimeType?: string;
}

export class CleanupMediaQueryDto {
  @ApiPropertyOptional({ default: true, description: 'Report what would be deleted without deleting' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  dryRun: boolean = true;
}

export class MediaFileDto {
  @ApiProperty({ example: 'https://cdn.example.com/media/2026/01/7b9.../preview.webp' }) url: string;
  @ApiProperty({ example: 1080 }) width: number;
  @ApiProperty({ example: 2400 }) height: number;
  @ApiProperty({ example: 245_000 }) size: number;
  @ApiProperty({ example: 'image/webp' }) mimeType: string;
}

export class MediaUsageDto {
  @ApiProperty({ example: 1 }) wallpapers: number;
  @ApiProperty({ example: 0 }) categories: number;
  @ApiProperty({ example: 0 }) banners: number;
}

export class MediaResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ nullable: true, example: 'mountain.jpg' }) originalFilename: string | null;
  @ApiProperty({ type: MediaFileDto }) original: MediaFileDto;
  @ApiProperty({ type: MediaFileDto, nullable: true }) preview: MediaFileDto | null;
  @ApiProperty({ type: MediaFileDto, nullable: true }) thumbnail: MediaFileDto | null;
  @ApiProperty({ type: MediaUsageDto }) usage: MediaUsageDto;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
}

export type BulkItemResult<T> =
  | { index: number; filename: string | null; status: 'success'; item: T }
  | { index: number; filename: string | null; status: 'error'; error: { statusCode: number; message: string } };

export interface BulkResult<T> {
  succeeded: number;
  failed: number;
  results: BulkItemResult<T>[];
}

export interface CleanupReport {
  dryRun: boolean;
  scannedObjects: number;
  orphanedObjects: number;
  deletedObjects: number;
  orphanedKeys: string[];
}

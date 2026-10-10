import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { AuditAction, AuditEntity } from '../audit-actions';

export class ListAuditLogsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  adminId?: string;

  @ApiPropertyOptional({ enum: Object.values(AuditAction) })
  @IsOptional()
  @IsIn(Object.values(AuditAction))
  action?: string;

  @ApiPropertyOptional({ enum: Object.values(AuditEntity) })
  @IsOptional()
  @IsIn(Object.values(AuditEntity))
  entityType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  entityId?: string;

  @ApiPropertyOptional({ example: '2026-01-01T00:00:00.000Z' })
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @ApiPropertyOptional({ example: '2026-12-31T23:59:59.999Z' })
  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;
}

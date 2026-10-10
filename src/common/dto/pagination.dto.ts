import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export const MAX_PAGE_LIMIT = 100;

export class PaginationQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1, example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  page: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_PAGE_LIMIT, default: 20, example: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_LIMIT)
  limit: number = 20;
}

export class PaginationMetaDto {
  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;

  @ApiProperty({ example: 100 })
  total: number;

  @ApiProperty({ example: 5 })
  totalPages: number;
}

/**
 * Marker class for paginated service results. The response interceptor passes instances
 * through unchanged (`{ data, meta }`) instead of wrapping them in another `data` envelope.
 */
export class Paginated<T> {
  constructor(
    public readonly data: T[],
    public readonly meta: PaginationMetaDto,
  ) {}

  static of<T>(data: T[], total: number, page: number, limit: number): Paginated<T> {
    return new Paginated(data, {
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    });
  }
}

export function toSkipTake(query: { page: number; limit: number }): { skip: number; take: number } {
  return { skip: (query.page - 1) * query.limit, take: query.limit };
}

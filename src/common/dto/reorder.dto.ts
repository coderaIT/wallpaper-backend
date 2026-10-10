import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsUUID, Max, Min, ValidateNested } from 'class-validator';

export class ReorderItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  id: string;

  @ApiProperty({ example: 0, minimum: 0, maximum: 1_000_000 })
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  sortOrder: number;
}

export class ReorderDto {
  @ApiProperty({
    type: [ReorderItemDto],
    example: [
      { id: '01928c1e-0000-7000-8000-000000000001', sortOrder: 0 },
      { id: '01928c1e-0000-7000-8000-000000000002', sortOrder: 1 },
    ],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ReorderItemDto)
  items: ReorderItemDto[];
}

export function assertUniqueIds(items: { id: string }[]): string[] {
  const ids = items.map((i) => i.id);
  return ids.filter((id, i) => ids.indexOf(id) !== i);
}

import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

const lifecycleStates = [
  'Pending',
  'Active',
  'Flagged',
  'Suspended',
  'Retired',
] as const;

export class DeviceListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @IsOptional()
  @IsIn(lifecycleStates)
  lifecycleState?: (typeof lifecycleStates)[number];

  @IsOptional()
  @IsString()
  search?: string;
}

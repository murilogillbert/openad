import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

function stripHtmlTags(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.replace(/<[^>]*>/g, '');
}

export class DeviceStateTransitionDto {
  @IsEnum(['Suspended', 'Active', 'Retired'] as const)
  toState!: 'Suspended' | 'Active' | 'Retired';

  @Transform(({ value }) => stripHtmlTags(value))
  @IsString()
  @MinLength(10)
  reason!: string;
}

export class DeviceLifecycleEventsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

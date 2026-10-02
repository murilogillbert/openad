import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateRolloutDto {
  @ApiPropertyOptional({ type: [String], description: 'DeviceGroup.groupId values' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  deviceGroupIds?: string[];

  @ApiPropertyOptional({ description: '0–100, null = no percentage gate' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  percentage?: number | null;
}

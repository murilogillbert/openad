import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

export class ReportReleaseStateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  versionIdentifier?: string;

  @ApiPropertyOptional({
    enum: ['up_to_date', 'update_available', 'update_failed', 'unknown'],
  })
  @IsOptional()
  @IsEnum(['up_to_date', 'update_available', 'update_failed', 'unknown'])
  lastCheckResult?: 'up_to_date' | 'update_available' | 'update_failed' | 'unknown';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  lastError?: string | null;
}

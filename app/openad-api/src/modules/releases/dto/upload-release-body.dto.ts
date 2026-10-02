import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MinLength } from 'class-validator';

export class UploadReleaseBodyDto {
  @ApiProperty({ example: '2.4.1' })
  @IsString()
  @MinLength(1)
  versionIdentifier!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  buildNumber?: number;

  @ApiPropertyOptional({ description: 'Admin-visible release notes' })
  @IsOptional()
  @IsString()
  releaseNotes?: string;
}

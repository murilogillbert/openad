import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsBoolean,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class DownloadedMediaEntryDto {
  @ApiProperty()
  @IsUUID()
  mediaId!: string;

  @ApiProperty()
  @IsString()
  hash!: string;

  @ApiProperty()
  @IsBoolean()
  verified!: boolean;
}

export class SyncStatusDto {
  @ApiProperty()
  @IsUUID()
  deviceId!: string;

  @ApiProperty()
  @IsString()
  manifestVersion!: string;

  @ApiProperty()
  @IsISO8601()
  syncedAt!: string;

  @ApiProperty({ type: [DownloadedMediaEntryDto] })
  @ValidateNested({ each: true })
  @Type(() => DownloadedMediaEntryDto)
  @ArrayMinSize(0)
  downloadedMedia!: DownloadedMediaEntryDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  storageUsed?: number;
}

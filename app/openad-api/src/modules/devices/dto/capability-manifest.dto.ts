import { Type } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CapabilityManifestUpdateDto {
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  screenWidthPx!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  screenHeightPx!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  screenSizeInches!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  totalStorageGb!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  availableStorageGb!: number;

  @IsString()
  osVersion!: string;

  @IsString()
  appVersion!: string;

  @IsOptional()
  @IsString()
  firmwareVersion?: string;
}

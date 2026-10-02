import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import type { CreateGeoZoneDto } from './create-geo-zone.dto';
import { SpatialBindingDto } from './spatial-binding.dto';

/** PATCH body: all fields optional; when `geometry` is set it must be a full Polygon or Circle. */
export class UpdateGeoZoneDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  city?: string;

  @IsOptional()
  @IsObject()
  geometry?: CreateGeoZoneDto['geometry'];

  @IsOptional()
  @IsArray()
  @ArrayMinSize(0)
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SpatialBindingDto)
  bindings?: SpatialBindingDto[];

  @IsOptional()
  @IsIn(['T1', 'T2', 'T3', 'T4'])
  tier?: 'T1' | 'T2' | 'T3' | 'T4';

  @IsOptional()
  @IsNumber()
  priorityScore?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  bufferExitMeters?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

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
import { SpatialBindingDto } from './spatial-binding.dto';

export class PolygonGeometryDto {
  @IsString()
  type!: 'Polygon';

  @IsArray()
  coordinates!: number[][][];
}

export class CircleGeometryDto {
  @IsString()
  type!: 'Circle';

  @IsObject()
  center!: { lng: number; lat: number };

  @IsNumber()
  @Min(1)
  radiusMeters!: number;
}

export class CreateGeoZoneDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  description!: string;

  @IsString()
  @IsNotEmpty()
  city!: string;

  /** Polygon or Circle (validated in GeoZoneService). */
  @IsObject()
  geometry!: PolygonGeometryDto | CircleGeometryDto;

  @IsArray()
  @ArrayMinSize(0)
  @IsString({ each: true })
  tags!: string[];

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

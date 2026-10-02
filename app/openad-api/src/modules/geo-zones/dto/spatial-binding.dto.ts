import { Type } from 'class-transformer';
import {
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class ArbitrationWeightsDto {
  @IsNumber()
  wp!: number;

  @IsNumber()
  wd!: number;

  @IsNumber()
  wh!: number;
}

export class SpatialBindingDto {
  @IsUUID()
  mediaId!: string;

  @IsIn(['entry', 'dwell'])
  triggerMode!: 'entry' | 'dwell';

  @IsOptional()
  @IsNumber()
  @Min(0)
  dwellSeconds?: number;

  @IsNumber()
  @Min(0)
  retriggerCooldownSeconds!: number;

  @IsIn(['sequential', 'weighted_random', 'priority_first'])
  rotationMode!: 'sequential' | 'weighted_random' | 'priority_first';

  @IsOptional()
  @IsNumber()
  velocityMaxKmh?: number;

  @IsOptional()
  @IsNumber()
  velocityMinKmh?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => ArbitrationWeightsDto)
  arbitrationWeights?: ArbitrationWeightsDto;

  @IsOptional()
  @IsNumber()
  pacingFactor?: number;

  @IsOptional()
  @IsObject()
  epicenter?: { lng: number; lat: number };
}

import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class VehicleCharacteristicsPatchDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  screenCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  passengerCapacity?: number;
}

export class UpdateVehicleDto {
  @IsOptional()
  @IsString()
  registrationPlate?: string;

  @IsOptional()
  @IsString()
  make?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1900)
  @Max(2100)
  year?: number;

  @IsOptional()
  @IsIn(['premium', 'taxi', 'van', 'other'])
  commercialTier?: 'premium' | 'taxi' | 'van' | 'other';

  /** Set to empty string to clear driver assignment. */
  @IsOptional()
  @IsString()
  @ValidateIf((_, v) => v !== undefined && v !== '')
  @IsUUID()
  driverId?: string;

  @IsOptional()
  @IsBoolean()
  inShop?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => VehicleCharacteristicsPatchDto)
  characteristics?: VehicleCharacteristicsPatchDto;
}

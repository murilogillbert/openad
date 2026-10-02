import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

export class CreateVehicleDto {
  @IsString()
  registrationPlate!: string;

  @IsString()
  make!: string;

  @IsString()
  model!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1900)
  @Max(2100)
  year!: number;

  @IsOptional()
  @IsIn(['premium', 'taxi', 'van', 'other'])
  commercialTier?: 'premium' | 'taxi' | 'van' | 'other';

  @IsOptional()
  @IsString()
  @ValidateIf((_, v) => v !== undefined && v !== '')
  @IsUUID()
  driverId?: string;

  /** Optional tablets to pair after create (reassigns from other vehicles if needed). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(32)
  @IsUUID('4', { each: true })
  pairedDeviceIds?: string[];
}

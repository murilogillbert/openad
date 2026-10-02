import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';

/** Body for POST /devices/inventory-register — serial required; screen dims come from tablet handshake. */
export class RegisterInventoryDeviceDto {
  @ApiProperty({ description: 'Manufacturer serial (unique in inventory)' })
  @IsString()
  @IsNotEmpty()
  @Length(1, 256)
  serialNumber!: string;

  @ApiPropertyOptional({
    description: 'Optional until device reports; omitted → 0 until handshake',
  })
  @IsOptional()
  @IsNumber()
  @Min(0.1)
  screenSizeInches?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 128)
  osVersion?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  storageCapacityGb?: number;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class DeviceStateDto {
  @ApiPropertyOptional({ description: 'GPS latitude' })
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ApiPropertyOptional({ description: 'GPS longitude' })
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @ApiPropertyOptional({ description: 'Speed km/h' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(200)
  speed?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  timestamp?: string;
}

export class ManifestRequestDto {
  @ApiProperty()
  @IsUUID()
  deviceId!: string;

  @ApiPropertyOptional({
    description: 'Last manifest version the device applied (ISO 8601)',
  })
  @IsOptional()
  @IsString()
  lastManifestVersion?: string;

  @ApiPropertyOptional({ type: DeviceStateDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => DeviceStateDto)
  deviceState?: DeviceStateDto;
}

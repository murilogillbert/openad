import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length, Matches, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class HardwareFingerprintDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  imei!: string | null;

  @ApiProperty()
  @IsString()
  @Length(1, 256)
  serialNumber!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 64)
  macAddress!: string;
}

export class PairingRegisterDto {
  @ApiProperty({ type: HardwareFingerprintDto })
  @ValidateNested()
  @Type(() => HardwareFingerprintDto)
  hardwareFingerprint!: HardwareFingerprintDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  clientDeviceId?: string;
}

export class PairingBindDto {
  @ApiProperty()
  @IsString()
  deviceId!: string;

  @ApiProperty({ type: HardwareFingerprintDto })
  @ValidateNested()
  @Type(() => HardwareFingerprintDto)
  hardwareFingerprint!: HardwareFingerprintDto;

  @ApiProperty({ description: 'One-time code from admin UI' })
  @IsString()
  @Length(4, 16)
  @Matches(/^[A-Z0-9]+$/i)
  secretCode!: string;
}

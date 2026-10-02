import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PriorityLevel } from '@openad/mqtt-contracts';
import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsUUID,
} from 'class-validator';

/** REST / internal DTO aligned with `priorityCommandSchema` (mqtt-contracts). */
export class PriorityCommandDto {
  @ApiProperty()
  @IsUUID()
  commandId!: string;

  @ApiProperty()
  @IsUUID()
  mediaId!: string;

  @ApiProperty({ enum: PriorityLevel })
  @IsEnum(PriorityLevel)
  priority!: PriorityLevel;

  @ApiProperty({ description: 'ISO-8601 expiry' })
  @IsISO8601()
  expiresAt!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  targetDeviceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  broadcast?: boolean;
}

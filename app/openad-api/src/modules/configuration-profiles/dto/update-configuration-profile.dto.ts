import { Type } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type { ConnectivityMode } from '@openad/domain';

class ExhibitionRulesPatchDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(10)
  @Max(3600)
  maxLoopLengthSeconds?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  adToContentRatio?: number;
}

export class UpdateConfigurationProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ExhibitionRulesPatchDto)
  exhibitionRules?: ExhibitionRulesPatchDto;

  @IsOptional()
  @IsEnum(['Economy', 'Premium'] as const)
  connectivityMode?: ConnectivityMode;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  @Max(10)
  commercialTierMultiplier?: number;
}

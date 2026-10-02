import { Type } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type { ConnectivityMode } from '@openad/domain';

class ExhibitionRulesDto {
  @Type(() => Number)
  @IsNumber()
  @Min(10)
  @Max(3600)
  maxLoopLengthSeconds!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  adToContentRatio!: number;
}

export class CreateConfigurationProfileDto {
  @IsString()
  @MaxLength(80)
  name!: string;

  @ValidateNested()
  @Type(() => ExhibitionRulesDto)
  exhibitionRules!: ExhibitionRulesDto;

  @IsEnum(['Economy', 'Premium'] as const)
  connectivityMode!: ConnectivityMode;

  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  @Max(10)
  commercialTierMultiplier!: number;
}

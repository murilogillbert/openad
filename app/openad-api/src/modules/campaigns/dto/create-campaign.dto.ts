import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Orcamento em **centavos inteiros**.
 *
 * `@IsInt` em vez de `@IsNumber` nao e detalhe: aceitar fracao de centavo e o que produzia o
 * arredondamento silencioso no pacing (`Math.max(1, Math.round(rate * 100))` fazia qualquer
 * tarifa abaixo de um centavo faturar um centavo).
 */
export class CampaignBudgetDto {
  @IsInt()
  @Min(0)
  totalAmountCents!: number;

  @IsString()
  @IsNotEmpty()
  currency!: string;

  @IsInt()
  @Min(0)
  ratePerImpressionCents!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  dailyBudgetCents?: number;
}

export class CreateCampaignDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  advertiserName!: string;

  @IsNumber()
  @Min(1)
  priority!: number;

  @IsString()
  @IsNotEmpty()
  scheduledStart!: string;

  @IsString()
  @IsNotEmpty()
  scheduledEnd!: string;

  @IsObject()
  @ValidateNested()
  @Type(() => CampaignBudgetDto)
  budget!: CampaignBudgetDto;
}

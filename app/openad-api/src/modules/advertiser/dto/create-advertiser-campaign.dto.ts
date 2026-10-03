import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class AdvertiserBudgetDto {
  /** Orcamento total em **centavos inteiros**. */
  @IsInt()
  @Min(1)
  totalAmountCents!: number;

  /** Tarifa por veiculacao faturavel, em **centavos inteiros**. */
  @IsInt()
  @Min(1)
  ratePerImpressionCents!: number;

  @IsString()
  @IsNotEmpty()
  currency!: string;
}

export class AdvertiserTargetingDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  cities?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  zoneIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tiers?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  vehicleTiers?: string[];

  /** Faixas horarias no formato `HH:mm-HH:mm`. Vazio = dia inteiro. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dayparts?: string[];
}

export class AdvertiserDriverPayoutDto {
  @IsEnum(['percent', 'per_play'])
  model!: 'percent' | 'per_play';

  /**
   * Fracao do valor faturavel, de 0 a 1. Validada contra
   * `platform_config.monetization.driverPayoutMinPercent` na criacao — recusa aqui e mais
   * barata que fila de moderacao.
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  percent?: number;

  /** Valor fixo por veiculacao, em centavos inteiros. */
  @IsOptional()
  @IsInt()
  @Min(1)
  valueCents?: number;
}

export class CreateAdvertiserCampaignDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  /**
   * Prioridade relativa entre as campanhas do proprio anunciante (1 = mais alta).
   *
   * Nao e prioridade global: a arbitragem combina isto com tier de zona, pacing e repasse.
   */
  @IsInt()
  @Min(1)
  @Max(100)
  priority!: number;

  @IsISO8601()
  scheduledStart!: string;

  @IsISO8601()
  scheduledEnd!: string;

  @IsObject()
  @ValidateNested()
  @Type(() => AdvertiserBudgetDto)
  budget!: AdvertiserBudgetDto;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => AdvertiserTargetingDto)
  targeting?: AdvertiserTargetingDto;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => AdvertiserDriverPayoutDto)
  driverPayout?: AdvertiserDriverPayoutDto;
}

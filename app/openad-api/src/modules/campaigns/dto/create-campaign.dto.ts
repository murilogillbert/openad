import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class CampaignBudgetDto {
  @IsNumber()
  @Min(0)
  totalAmount!: number;

  @IsString()
  @IsNotEmpty()
  currency!: string;

  @IsNumber()
  @Min(0)
  ratePerImpression!: number;
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

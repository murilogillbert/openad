import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class InventoryZonesQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @IsOptional()
  @IsIn(['T1', 'T2', 'T3', 'T4'])
  tier?: string;
}

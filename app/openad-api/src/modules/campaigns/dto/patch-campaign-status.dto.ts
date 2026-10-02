import { IsEnum } from 'class-validator';

export class PatchCampaignStatusDto {
  @IsEnum(['active', 'paused', 'completed'] as const)
  status!: 'active' | 'paused' | 'completed';
}

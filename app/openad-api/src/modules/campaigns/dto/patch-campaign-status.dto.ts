import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { CAMPAIGN_STATUSES, type CampaignStatus } from '../campaign.schema';

export class PatchCampaignStatusDto {
  @IsIn(CAMPAIGN_STATUSES as unknown as string[])
  status!: CampaignStatus;

  /**
   * Motivo da decisao de moderacao. Obrigatorio ao recusar — o anunciante precisa saber o
   * que corrigir, e a recusa fica registrada em `campaigns.moderation`.
   */
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason?: string;
}

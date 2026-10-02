import { IsIn, IsUUID } from 'class-validator';

export class ProofOfPlayDto {
  @IsUUID('4')
  campaignId!: string;

  @IsIn(['json', 'csv', 'pdf'])
  format!: 'json' | 'csv' | 'pdf';
}

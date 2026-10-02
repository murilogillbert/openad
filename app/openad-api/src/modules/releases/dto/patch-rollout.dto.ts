import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';

export class PatchRolloutDto {
  @ApiProperty({
    enum: ['draft', 'active', 'paused', 'completed', 'cancelled'],
  })
  @IsEnum(['draft', 'active', 'paused', 'completed', 'cancelled'])
  status!: 'draft' | 'active' | 'paused' | 'completed' | 'cancelled';
}

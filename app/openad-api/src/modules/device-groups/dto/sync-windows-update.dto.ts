import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';

export class SyncWindowRuleBodyDto {
  @IsString()
  @Matches(/^\d{2}:\d{2}$/)
  startTime!: string;

  @IsString()
  @Matches(/^\d{2}:\d{2}$/)
  endTime!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsNumber({}, { each: true })
  daysOfWeek!: number[];

  @IsNumber()
  sizeThresholdMb!: number;
}

export class SyncWindowsUpdateDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SyncWindowRuleBodyDto)
  rules!: SyncWindowRuleBodyDto[];
}

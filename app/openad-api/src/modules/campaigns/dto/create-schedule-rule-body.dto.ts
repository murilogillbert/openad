import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class TimeWindowDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  daysOfWeek!: string[];

  @IsString()
  @IsNotEmpty()
  startTime!: string;

  @IsString()
  @IsNotEmpty()
  endTime!: string;

  @IsString()
  @IsNotEmpty()
  timezone!: string;
}

export class CreateScheduleRuleBodyDto {
  @IsString()
  @IsNotEmpty()
  assetId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  geoZoneIds!: string[];

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TimeWindowDto)
  timeWindows!: TimeWindowDto[];

  @IsInt()
  @Min(0)
  dwellThresholdSeconds!: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  priority!: number | null;
}

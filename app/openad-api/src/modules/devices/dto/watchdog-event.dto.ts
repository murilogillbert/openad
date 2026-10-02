import { IsObject, IsOptional, IsString } from 'class-validator';

export class WatchdogEventDto {
  @IsString()
  eventType!: string;

  @IsString()
  occurredAt!: string;

  @IsOptional()
  @IsObject()
  context?: Record<string, unknown>;
}

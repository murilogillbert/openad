import { IsIn, IsObject, IsOptional } from 'class-validator';
import type { RemoteCommandType } from '@openad/api-contracts';

const COMMAND_TYPES: RemoteCommandType[] = [
  'RESTART',
  'SYNC_SCHEDULE',
  'CLEAR_CACHE',
  'CUSTOM',
  'GET_SCREENSHOT',
  'UPGRADE_APP',
  'SET_VOLUME',
  'SET_BRIGHTNESS',
  'EMERGENCY_SYNC',
  'TEMP_DISABLE_KIOSK',
];

export class IssueCommandDto {
  @IsIn(COMMAND_TYPES)
  type!: RemoteCommandType;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown> | null;
}

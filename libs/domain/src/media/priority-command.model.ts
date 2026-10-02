export type PriorityLevelKind = 'emergency' | 'high' | 'standard';

export interface PriorityCommandModel {
  commandId: string;
  mediaId: string;
  priority: PriorityLevelKind;
  expiresAt: string;
  targetDeviceId?: string;
  broadcast?: boolean;
}

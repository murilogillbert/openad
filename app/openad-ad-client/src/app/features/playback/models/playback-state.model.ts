export type PlaybackStatus = 'idle' | 'playing' | 'error';

export interface PlaybackStateSnapshot {
  status: PlaybackStatus;
  currentMediaId: string | null;
  errorMessage: string | null;
}

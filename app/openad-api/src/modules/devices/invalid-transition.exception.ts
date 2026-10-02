import type { DeviceLifecycleState } from '@openad/domain';

export class InvalidTransitionException extends Error {
  constructor(
    readonly fromState: DeviceLifecycleState,
    readonly toState: DeviceLifecycleState
  ) {
    super(`Invalid lifecycle transition ${fromState} → ${toState}`);
    this.name = 'InvalidTransitionException';
  }
}

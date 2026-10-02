import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PinoLogger } from 'nestjs-pino';
import type {
  DeviceLifecycleEvent,
  DeviceLifecycleEventTrigger,
  DeviceLifecycleState,
} from '@openad/domain';
import { DeviceLifecycleEventRepository } from './device-lifecycle-event.repository';
import { RetiredDeviceRegistryRepository } from './retired-device-registry.repository';
import { DevicesRepository } from './devices.repository';
import { InvalidTransitionException } from './invalid-transition.exception';
import type { DeviceDocument } from './devices.schema';

/** Valid (from → to) pairs from `data-model.md` transition matrix. */
const VALID_TRANSITION_KEYS = new Set<string>([
  'Pending,Active',
  'Pending,Retired',
  'Active,Flagged',
  'Active,Suspended',
  'Active,Retired',
  'Flagged,Active',
  'Flagged,Suspended',
  'Flagged,Retired',
  'Suspended,Active',
  'Suspended,Retired',
]);

function transitionKey(
  from: DeviceLifecycleState,
  to: DeviceLifecycleState
): string {
  return `${from},${to}`;
}

function resolveCurrentLifecycle(doc: DeviceDocument): DeviceLifecycleState {
  return doc.lifecycleState;
}

@Injectable()
export class DeviceStateMachineService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly devices: DevicesRepository,
    private readonly lifecycleEvents: DeviceLifecycleEventRepository,
    private readonly retiredRegistry: RetiredDeviceRegistryRepository
  ) {
    this.logger.setContext(DeviceStateMachineService.name);
  }

  async transitionTo(
    deviceId: string,
    toState: DeviceLifecycleState,
    trigger: DeviceLifecycleEventTrigger
  ): Promise<DeviceLifecycleEvent> {
    const device = await this.devices.findByDeviceId(deviceId);
    if (!device) {
      throw new NotFoundException('Device not found');
    }

    const fromState = resolveCurrentLifecycle(device);

    if (!VALID_TRANSITION_KEYS.has(transitionKey(fromState, toState))) {
      this.logger.warn(
        {
          event: 'device.state.transition',
          deviceId,
          fromState,
          toState,
          outcome: 'rejected',
          reason: 'invalid_transition',
        },
        'lifecycle transition rejected'
      );
      throw new InvalidTransitionException(fromState, toState);
    }

    const eventId = randomUUID();
    const occurredAt = new Date();

    await this.devices.updateOne(
      { deviceId },
      {
        $set: {
          lifecycleState: toState,
        },
      }
    );

    await this.lifecycleEvents.create({
      eventId,
      deviceId,
      fromState,
      toState,
      trigger,
      occurredAt,
    });

    if (toState === 'Retired') {
      const retiredByAdminId =
        trigger.type === 'admin' ? (trigger.actorId ?? 'unknown') : 'system';
      await this.retiredRegistry.insert({
        deviceId,
        retiredAt: occurredAt,
        retiredByAdminId,
      });
    }

    this.logger.info(
      {
        event: 'device.state.transition',
        deviceId,
        fromState,
        toState,
        triggerType: trigger.type,
        triggerDetail: trigger.detail,
        eventId,
      },
      'lifecycle transition applied'
    );

    return {
      eventId,
      deviceId,
      fromState,
      toState,
      trigger,
      occurredAt: occurredAt.toISOString(),
    };
  }
}

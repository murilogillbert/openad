import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { UserRole } from '@openad/domain';
import type { Namespace, Server, Socket } from 'socket.io';
import type { JwtAccessPayload } from '../auth/auth.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import type {
  ConfigSyncCompleteEvent,
  DeviceStateChangedEvent,
} from '@openad/api-contracts';
import { FleetMapService } from './fleet-map.service';
import { OperationsKpisService } from './operations-kpis.service';

const DASHBOARD_CHANNEL = 'pubsub:dashboard';

const FLEET_MAP_ROLES: ReadonlySet<UserRole> = new Set([
  'fleet_admin',
  'fleet_operator',
  'campaign_manager',
  'super_admin',
]);

@WebSocketGateway({
  namespace: '/fleet',
  cors: { origin: true, credentials: true },
})
export class FleetGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(FleetGateway.name);

  private fleetMapPushTimer: ReturnType<typeof setTimeout> | null = null;

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    private readonly fleetMap: FleetMapService,
    private readonly operationsKpis: OperationsKpisService
  ) {}

  afterInit(): void {
    void this.redis.subscribe(DASHBOARD_CHANNEL, (_ch, msg) => {
      try {
        const data = JSON.parse(msg) as Record<string, unknown>;
        this.server.emit('fleet', data);
      } catch {
        this.logger.warn('invalid pubsub payload');
      }
    });
    this.logger.log(`Socket.io /fleet subscribed to ${DASHBOARD_CHANNEL}`);
  }

  handleConnection(client: Socket): void {
    const raw = client.handshake.auth?.['token'] as string | undefined;
    if (!raw) {
      client.disconnect(true);
      return;
    }
    const token = raw.replace(/^Bearer\s+/i, '');
    let decoded: JwtAccessPayload;
    try {
      decoded = this.jwt.verify<JwtAccessPayload>(token);
    } catch {
      client.disconnect(true);
      return;
    }
    (client.data as { userRole?: UserRole }).userRole = decoded.role;
    void client.join('fleet');
    void this.operationsKpis.getSnapshot().then((payload) => {
      client.emit('operations_kpis', payload);
    });
  }

  /** Debounced push of map snapshots to every socket that subscribed with filters. */
  requestFleetMapRefresh(): void {
    if (this.fleetMapPushTimer) {
      clearTimeout(this.fleetMapPushTimer);
    }
    this.fleetMapPushTimer = setTimeout(() => {
      this.fleetMapPushTimer = null;
      void this.flushFleetMapSnapshots();
      void this.flushOperationsKpis();
    }, 350);
  }

  private async flushOperationsKpis(): Promise<void> {
    try {
      const payload = await this.operationsKpis.getSnapshot();
      this.server.to('fleet').emit('operations_kpis', payload);
    } catch (e: unknown) {
      this.logger.warn({ err: e }, 'operations_kpis broadcast failed');
    }
  }

  private async flushFleetMapSnapshots(): Promise<void> {
    /** Nest injects the namespace server; `Namespace.sockets` is the Map of connected clients. */
    const nsp = this.server as unknown as Namespace;
    const connected = nsp.sockets;
    const tasks: Promise<void>[] = [];
    for (const [, socket] of connected) {
      const q = (socket.data as { fleetMapQuery?: Record<string, unknown> })
        .fleetMapQuery;
      if (q === undefined) continue;
      tasks.push(
        (async () => {
          try {
            const snap = await this.fleetMap.getSnapshot(q);
            socket.emit('fleet_map_snapshot', snap);
          } catch (e: unknown) {
            this.logger.warn({ err: e }, 'fleet_map_snapshot push failed');
            socket.emit('fleet_map_error', { code: 'snapshot_failed' });
          }
        })()
      );
    }
    await Promise.all(tasks);
  }

  private roleAllowsFleetMap(role: UserRole | undefined): boolean {
    return role != null && FLEET_MAP_ROLES.has(role);
  }

  @SubscribeMessage('fleet_map_subscribe')
  async onFleetMapSubscribe(
    @MessageBody() body: Record<string, unknown> | undefined,
    @ConnectedSocket() client: Socket
  ): Promise<void> {
    const role = (client.data as { userRole?: UserRole }).userRole;
    if (!this.roleAllowsFleetMap(role)) {
      client.emit('fleet_map_error', { code: 'forbidden' });
      return;
    }
    (client.data as { fleetMapQuery?: Record<string, unknown> }).fleetMapQuery =
      body ?? {};
    const q = (client.data as { fleetMapQuery: Record<string, unknown> })
      .fleetMapQuery;
    try {
      const snap = await this.fleetMap.getSnapshot(q);
      client.emit('fleet_map_snapshot', snap);
    } catch (e: unknown) {
      this.logger.warn({ err: e }, 'fleet_map_subscribe snapshot failed');
      client.emit('fleet_map_error', { code: 'snapshot_failed' });
    }
  }

  @SubscribeMessage('fleet_map_unsubscribe')
  onFleetMapUnsubscribe(@ConnectedSocket() client: Socket): void {
    delete (client.data as { fleetMapQuery?: Record<string, unknown> })
      .fleetMapQuery;
  }

  emitDeviceStateChanged(event: DeviceStateChangedEvent): void {
    this.server.to('fleet').emit('device_state_changed', event);
  }

  emitConfigSyncComplete(event: ConfigSyncCompleteEvent): void {
    this.server.to('fleet').emit('config_sync_complete', event);
  }
}

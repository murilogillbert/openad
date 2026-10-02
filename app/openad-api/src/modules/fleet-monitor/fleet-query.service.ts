import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type { FleetStatusResponse } from '@openad/api-contracts';
import { FleetStatusRepository } from '../vehicles/fleet-status.repository';
import { fleetDocumentToItem } from './fleet-status.mapper';

@Injectable()
export class FleetQueryService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly fleetStatus: FleetStatusRepository
  ) {
    this.logger.setContext(FleetQueryService.name);
  }

  async getStatus(): Promise<FleetStatusResponse> {
    const docs = await this.fleetStatus.findAll();
    const staleBefore = new Date(Date.now() - 30_000).toISOString();
    this.logger.info(
      { event: 'fleet.status.snapshot', deviceCount: docs.length },
      'fleet status loaded'
    );
    return {
      data: docs.map((d) => fleetDocumentToItem(d)),
      staleBefore,
    };
  }
}

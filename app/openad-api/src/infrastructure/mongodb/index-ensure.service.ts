import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

/**
 * Ensures schema indexes are applied, then verifies critical indexes exist (data-model.md).
 * Logs warnings only — does not block startup.
 *
 * `autoIndex: true` alone is racy: index creation can still be in flight when this hook runs.
 * We call `connection.syncIndexes()` first so verification sees a consistent state on fresh DBs.
 */
@Injectable()
export class IndexEnsureService implements OnApplicationBootstrap {
  private readonly logger = new Logger(IndexEnsureService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.verify();
    } catch (e) {
      this.logger.warn(
        `Index verification failed: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  private async verify(): Promise<void> {
    const db = this.connection.db;
    if (!db || this.connection.readyState !== 1) {
      return;
    }

    const autoIndex =
      (process.env.MONGOOSE_AUTO_INDEX ?? '').toLowerCase() !== 'false';
    if (autoIndex) {
      try {
        await this.connection.syncIndexes();
      } catch (e) {
        this.logger.warn(
          `syncIndexes failed: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }

    const checks: { collection: string; expectNames: string[] }[] = [
      { collection: 'devices', expectNames: ['deviceId_1', 'serialNumber_1'] },
      { collection: 'vehicles', expectNames: ['vehicleId_1', 'registrationPlate_1'] },
      { collection: 'campaigns', expectNames: ['campaignId_1'] },
      { collection: 'impression_events', expectNames: ['eventId_1'] },
      { collection: 'report_jobs', expectNames: ['jobId_1'] },
    ];

    for (const { collection, expectNames } of checks) {
      const coll = db.collection(collection);
      const exists = (await db.listCollections({ name: collection }).toArray())
        .length;
      if (!exists) {
        this.logger.warn(`Collection missing (may be empty app): ${collection}`);
        continue;
      }
      const indexes = await coll.indexes();
      const names = new Set(indexes.map((i) => i.name));
      for (const n of expectNames) {
        if (!names.has(n)) {
          this.logger.warn(
            `Expected index "${n}" not found on "${collection}" — check schema index definitions and MONGOOSE_AUTO_INDEX (or recreate collection).`
          );
        }
      }
    }
  }
}

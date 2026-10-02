import { Injectable } from '@nestjs/common';
import {
  collectDefaultMetrics,
  Counter,
  Histogram,
  Registry,
} from 'prom-client';

@Injectable()
export class MetricsService {
  readonly registry = new Registry();
  readonly manifestGenerationSeconds: Histogram;
  readonly manifestDeltaSeconds: Histogram;
  /** Spatial section only — `SpatialManifestBuilderService.build()` */
  readonly spatialManifestBuildSeconds: Histogram;
  /** Media VFS: clone / delete / patch / complete timings */
  readonly mediaVfsOperationSeconds: Histogram;
  readonly mediaVfsMutationsTotal: Counter;

  constructor() {
    collectDefaultMetrics({ register: this.registry });
    this.manifestGenerationSeconds = new Histogram({
      name: 'openad_manifest_generation_seconds',
      help: 'Time to build a device manifest (generator + presigns)',
      buckets: [0.01, 0.05, 0.1, 0.2, 0.5, 1, 2, 5],
      registers: [this.registry],
    });
    this.manifestDeltaSeconds = new Histogram({
      name: 'openad_manifest_delta_seconds',
      help: 'Time to compute JSON Patch delta between manifest versions',
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
      registers: [this.registry],
    });
    this.spatialManifestBuildSeconds = new Histogram({
      name: 'openad_spatial_manifest_build_seconds',
      help: 'Time to build spatial manifest entries (geo zones + serialization)',
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.2, 0.5, 1, 2],
      registers: [this.registry],
    });
    this.mediaVfsOperationSeconds = new Histogram({
      name: 'openad_media_vfs_operation_seconds',
      help: 'Latency of media VFS operations (clone, delete, patch, complete)',
      labelNames: ['op'],
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
      registers: [this.registry],
    });
    this.mediaVfsMutationsTotal = new Counter({
      name: 'openad_media_vfs_mutations_total',
      help: 'Count of media VFS mutations by operation and outcome',
      labelNames: ['op', 'outcome'],
      registers: [this.registry],
    });
  }

  async renderPrometheusText(): Promise<string> {
    return this.registry.metrics();
  }
}

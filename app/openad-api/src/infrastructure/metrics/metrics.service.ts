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
  /**
   * Itens de midia suprimidos do manifesto por segmentacao, rotulados pelo motivo.
   *
   * Contador, nao documento por evento: o manifesto e puxado por cada tablete a cada 15 min,
   * e gravar uma linha por item suprimido seria da ordem de `frota x campanhas` escritas por
   * ciclo, para um dado que ninguem le evento a evento. O que o anunciante precisa saber e
   * "quanto" e "por que", e isso o contador responde com a mesma fidelidade.
   *
   * `lost_opportunity_events` continua sendo o lugar dos eventos reportados **pelo tablete**
   * por MQTT (`higher_tier`, `cooldown`, `velocity`, `loop_lock`), que sao decisoes de
   * arbitragem na ponta. Supressao por segmentacao e decisao do servidor, com natureza e
   * volume diferentes — misturar as duas na mesma colecao tornaria qualquer consulta
   * ambigua, alem de `zoneId` ser obrigatorio la e nao existir aqui.
   */
  readonly manifestTargetingSuppressedTotal: Counter;

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
    this.manifestTargetingSuppressedTotal = new Counter({
      name: 'openad_manifest_targeting_suppressed_total',
      help: 'Media items excluded from a manifest by campaign targeting, by reason',
      // `campaignId` **nao** entra como rotulo de proposito: rotulo de cardinalidade alta
      // multiplica series temporais sem limite e e a forma classica de derrubar o Prometheus.
      // O campaignId vai no log estruturado, que e onde investigacao individual acontece.
      labelNames: ['reason'],
      registers: [this.registry],
    });
  }

  async renderPrometheusText(): Promise<string> {
    return this.registry.metrics();
  }
}

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { GeoZone, GeoZoneDocument } from '../../geo-zones/geo-zone.schema';
import { Vehicle, VehicleDocument } from '../../vehicles/vehicles.schema';
import { Device, DeviceDocument } from '../../devices/devices.schema';

/**
 * Resultado da checagem de alcance.
 *
 * Não é união discriminada (`{ ok: true } | { ok: false; motivo }`) pela mesma razão
 * documentada em `internal/driver-payout.policy.ts`: este projeto compila **sem
 * `strictNullChecks`**, e sem ele o compilador não estreita o tipo por `if (!r.ok)` — o
 * acesso a `motivo` no ramo de recusa simplesmente não compila. Com `motivo` anulável a
 * checagem funciona nos dois modos.
 */
export interface ResultadoDeAlcance {
  ok: boolean;
  motivo: string | null;
}

const ALCANCA: ResultadoDeAlcance = { ok: true, motivo: null };

/** Segmentação de uma campanha, como gravada em `campaigns.targeting`. */
export interface Segmentacao {
  cities: string[];
  zoneIds: string[];
  tiers: string[];
  vehicleTiers: string[];
  dayparts: string[];
}

/** O que se sabe do dispositivo no momento de montar o manifesto. */
export interface ContextoDoDispositivo {
  deviceId: string;
  vehicleId: string | null;
  /** Tier comercial do veículo (`premium | taxi | van | other`). */
  vehicleTier: string | null;
  /** Zonas ativas que contêm a posição reportada. Vazio quando não há GPS. */
  zoneIds: string[];
  cities: string[];
  zoneTiers: string[];
  /** Momento de referência, em UTC, para avaliar `dayparts`. */
  agora: Date;
}

@Injectable()
export class TargetingMatcherService {
  constructor(
    @InjectModel(GeoZone.name)
    private readonly zones: Model<GeoZoneDocument>,
    @InjectModel(Vehicle.name)
    private readonly vehicles: Model<VehicleDocument>,
    @InjectModel(Device.name)
    private readonly devices: Model<DeviceDocument>
  ) {}

  /**
   * Resolve o contexto do tablete: qual veículo, qual tier, e em que zonas ele está.
   *
   * A posição vem do `deviceState` que o próprio tablete envia no `POST /manifest`. Até esta
   * leva esse parâmetro era literalmente descartado (`void deviceState`), e o efeito era que
   * **toda** campanha ia para **toda** a frota: `campaigns.targeting` era gravado pelas rotas
   * do anunciante e nunca consultado na entrega. Um anunciante que pagou por uma cidade
   * recebia veiculação de todo o país — e o `lost_opportunity_events`, que existe para
   * explicar por que um anúncio não tocou, nunca tinha nada a registrar porque nada era
   * suprimido.
   */
  async contextoDe(
    deviceId: string,
    estado: { latitude?: number; longitude?: number } | undefined,
    agora: Date = new Date()
  ): Promise<ContextoDoDispositivo> {
    const device = await this.devices
      .findOne({ deviceId })
      .select({ boundVehicleId: 1 })
      .lean()
      .exec();

    const vehicleId = device?.boundVehicleId ?? null;
    let vehicleTier: string | null = null;
    if (vehicleId) {
      const v = await this.vehicles
        .findOne({ vehicleId })
        .select({ commercialTier: 1 })
        .lean()
        .exec();
      vehicleTier = v?.commercialTier ?? null;
    }

    let zoneIds: string[] = [];
    let cities: string[] = [];
    let zoneTiers: string[] = [];

    if (
      typeof estado?.latitude === 'number' &&
      typeof estado?.longitude === 'number'
    ) {
      /**
       * `$geoIntersects` sobre o índice `2dsphere`, restrito a `Polygon`.
       *
       * O índice do schema é parcial (`partialFilterExpression: { 'geometry.type': 'Polygon' }`)
       * porque zona circular é guardada como `{ type: 'Circle', center, radiusMeters }`, que
       * não é GeoJSON válido e o Mongo não indexa. Consultar sem esse filtro não quebraria,
       * mas varreria a coleção; as circulares são tratadas em memória logo abaixo.
       */
      const poligonais = await this.zones
        .find({
          isActive: true,
          'geometry.type': 'Polygon',
          geometry: {
            $geoIntersects: {
              $geometry: {
                type: 'Point',
                coordinates: [estado.longitude, estado.latitude],
              },
            },
          },
        })
        .select({ zoneId: 1, city: 1, tier: 1 })
        .lean()
        .exec();

      const circulares = await this.zones
        .find({ isActive: true, 'geometry.type': 'Circle' })
        .select({ zoneId: 1, city: 1, tier: 1, geometry: 1 })
        .lean()
        .exec();

      const dentroDeCirculo = circulares.filter((z) => {
        const g = z.geometry as {
          type: string;
          center?: { lng: number; lat: number };
          radiusMeters?: number;
        };
        if (!g.center || typeof g.radiusMeters !== 'number') {
          return false;
        }
        return (
          distanciaEmMetros(
            estado.latitude as number,
            estado.longitude as number,
            g.center.lat,
            g.center.lng
          ) <= g.radiusMeters
        );
      });

      const todas = [...poligonais, ...dentroDeCirculo];
      zoneIds = todas.map((z) => z.zoneId);
      cities = [...new Set(todas.map((z) => z.city))];
      zoneTiers = [...new Set(todas.map((z) => z.tier))];
    }

    return {
      deviceId,
      vehicleId,
      vehicleTier,
      zoneIds,
      cities,
      zoneTiers,
      agora,
    };
  }

  /**
   * A campanha alcança este dispositivo?
   *
   * Cada dimensão vazia significa "sem restrição" — é a convenção do schema
   * (`default: []`), e é o que mantém compatível toda campanha criada antes de `targeting`
   * existir. As dimensões preenchidas são combinadas por **conjunção**: cidade *e* zona *e*
   * tier *e* faixa horária. Disjunção faria a segmentação ser quase sempre verdadeira e o
   * anunciante pagaria por alcance que não pediu.
   *
   * Devolve o motivo quando recusa, porque é ele que vai para `lost_opportunity_events` —
   * sem isso o leilão é caixa-preta e gera disputa com o parceiro.
   */
  alcanca(
    seg: Segmentacao | null | undefined,
    ctx: ContextoDoDispositivo
  ): ResultadoDeAlcance {
    if (!seg) {
      return ALCANCA;
    }

    /**
     * Sem GPS, segmentação **geográfica** não é avaliada — a campanha passa.
     *
     * Parece permissivo e é a escolha certa: o tablete perde sinal em túnel, garagem e
     * estacionamento coberto. Tratar ausência de GPS como "não alcança" tiraria do ar toda
     * campanha segmentada justamente nos lugares onde o veículo fica parado mais tempo, e o
     * efeito prático seria o anunciante ver entrega cair sem explicação. A verificação de
     * geofence no momento da **veiculação** é que decide se aquele play é faturável — é lá
     * que a exigência de posição é dura, porque é lá que vira dinheiro.
     */
    const temGeo = ctx.zoneIds.length > 0;

    if (seg.zoneIds?.length && temGeo) {
      if (!seg.zoneIds.some((z) => ctx.zoneIds.includes(z))) {
        return { ok: false, motivo: 'targeting_zone' };
      }
    }

    if (seg.cities?.length && temGeo) {
      const normalizadas = seg.cities.map(normalizar);
      if (!ctx.cities.some((c) => normalizadas.includes(normalizar(c)))) {
        return { ok: false, motivo: 'targeting_city' };
      }
    }

    if (seg.tiers?.length && temGeo) {
      if (!ctx.zoneTiers.some((t) => seg.tiers.includes(t))) {
        return { ok: false, motivo: 'targeting_zone_tier' };
      }
    }

    /**
     * Tier de veículo **é** avaliado mesmo sem GPS: ele não depende de posição, vem do
     * cadastro. Tablete sem veículo vinculado não casa com nenhum tier pedido.
     */
    if (seg.vehicleTiers?.length) {
      if (!ctx.vehicleTier || !seg.vehicleTiers.includes(ctx.vehicleTier)) {
        return { ok: false, motivo: 'targeting_vehicle_tier' };
      }
    }

    if (seg.dayparts?.length) {
      if (!seg.dayparts.some((d) => dentroDaFaixa(d, ctx.agora))) {
        return { ok: false, motivo: 'targeting_daypart' };
      }
    }

    return ALCANCA;
  }
}

/** Compara cidade sem acento e sem caixa: "São Paulo" e "sao paulo" são a mesma. */
function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

/**
 * `HH:mm-HH:mm` em UTC contém o instante?
 *
 * Trata a faixa que atravessa a meia-noite (`22:00-02:00`) como união dos dois trechos. Sem
 * isso, `inicio > fim` nunca casaria e uma campanha de madrugada simplesmente não tocaria —
 * falha silenciosa, porque a configuração parece válida.
 */
function dentroDaFaixa(faixa: string, agora: Date): boolean {
  const m = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(faixa.trim());
  if (!m) {
    // Faixa malformada não deve derrubar a entrega: ignorar é mais seguro que recusar tudo.
    return true;
  }
  const minutos = agora.getUTCHours() * 60 + agora.getUTCMinutes();
  const inicio = Number(m[1]) * 60 + Number(m[2]);
  const fim = Number(m[3]) * 60 + Number(m[4]);
  if (inicio <= fim) {
    return minutos >= inicio && minutos <= fim;
  }
  return minutos >= inicio || minutos <= fim;
}

/** Haversine. Suficiente para raio de zona, que é da ordem de centenas de metros. */
function distanciaEmMetros(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6_371_000;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type { FleetAuditContext } from '../../infrastructure/logging/fleet-audit.context';
import { DevicesRepository } from '../devices/devices.repository';
import { VehiclesRepository } from '../vehicles/vehicles.repository';
import { VehicleBindingAuditService } from '../vehicles/vehicle-binding-audit.service';
import { PlatformConfigRuntimeService } from '../platform-config/platform-config-runtime.service';
import {
  DriverDirectoryService,
  type MotoristaResumo,
} from './driver-directory.service';

export interface VinculoDeMotorista {
  deviceId: string;
  vehicleId: string | null;
  driver: MotoristaResumo | null;
  /** Fracao do valor faturavel que vai para o motorista. Hoje 0,3. */
  payoutMinPercent: number;
}

/**
 * Vincula um motorista a um tablete.
 *
 * **O armazenamento continua em `vehicles.driverId`**, apesar de a operacao ser "por
 * aparelho". Isso e deliberado: `vehicles.driverId` e a unica fonte que o credito de
 * repasse (`analytics-reconciliation.processor.ts`) e o relatorio de conferencia
 * (`ad-payouts-report.service.ts`) consultam. Guardar o motorista tambem no aparelho criaria
 * duas respostas para "quem recebe por esta veiculacao", e a divergencia entre elas seria
 * descoberta em forma de reclamacao de pagamento.
 *
 * O aparelho e a chave da operacao porque e o objeto que o operador tem na mao, e porque um
 * motorista pode ter **0..N tabletes**: `vehicles.pairedDeviceIds` ja e um array, entao N
 * tabletes no mesmo veiculo apontam para o mesmo motorista sem nenhuma estrutura nova.
 *
 * Exige tablete ja pareado a um veiculo. Criar veiculo por conta propria aqui seria inventar
 * placa e tier comercial — e o tier decide segmentacao de campanha, ou seja, decide
 * faturamento.
 */
@Injectable()
export class DeviceDriverBindingService {
  constructor(
    private readonly devices: DevicesRepository,
    private readonly vehicles: VehiclesRepository,
    private readonly diretorio: DriverDirectoryService,
    private readonly bindingAudit: VehicleBindingAuditService,
    private readonly platform: PlatformConfigRuntimeService,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(DeviceDriverBindingService.name);
  }

  private piso(): number {
    return this.platform.get().monetization.driverPayoutMinPercent;
  }

  /** Veiculo do aparelho, ou 409 explicando o que falta fazer antes. */
  private async exigirVeiculo(deviceId: string): Promise<string> {
    const device = await this.devices.findByDeviceId(deviceId);
    if (!device) {
      throw new NotFoundException({ code: 'DEVICE_NOT_FOUND', deviceId });
    }
    const vehicleId = device.boundVehicleId ?? null;
    if (!vehicleId) {
      throw new ConflictException({
        code: 'DEVICE_WITHOUT_VEHICLE',
        message:
          'Aparelho nao esta pareado a um veiculo. Cadastre o veiculo e pareie o aparelho antes de vincular o motorista.',
        deviceId,
      });
    }
    return vehicleId;
  }

  async consultar(deviceId: string): Promise<VinculoDeMotorista> {
    const device = await this.devices.findByDeviceId(deviceId);
    if (!device) {
      throw new NotFoundException({ code: 'DEVICE_NOT_FOUND', deviceId });
    }
    const vehicleId = device.boundVehicleId ?? null;
    let driver: MotoristaResumo | null = null;
    if (vehicleId) {
      const v = await this.vehicles.findByVehicleId(vehicleId);
      if (v?.driverId) {
        /**
         * Pode devolver `null` mesmo com `driverId` gravado: vinculo feito antes desta
         * validacao existir aceitava qualquer UUID. Expor como "sem motorista" e correto —
         * um identificador que nao resolve nao recebe dinheiro.
         */
        driver = await this.diretorio.resolver(v.driverId);
      }
    }
    return {
      deviceId,
      vehicleId,
      driver,
      payoutMinPercent: this.piso(),
    };
  }

  async vincular(
    deviceId: string,
    driverUserId: string,
    audit: FleetAuditContext
  ): Promise<VinculoDeMotorista> {
    const vehicleId = await this.exigirVeiculo(deviceId);

    const driver = await this.diretorio.resolver(driverUserId);
    if (!driver) {
      throw new NotFoundException({
        code: 'DRIVER_NOT_FOUND',
        message:
          'Nenhum motorista com este identificador no cadastro do ecossistema.',
        driverUserId,
      });
    }

    await this.vehicles.updateOne(
      { vehicleId },
      { $set: { driverId: driver.userId } }
    );

    await this.bindingAudit.append(
      { action: 'driver_bind', vehicleId, deviceId },
      audit
    );

    this.logger.info(
      {
        ...audit,
        event: 'motorista.vinculado',
        deviceId,
        vehicleId,
        driverUserId: driver.userId,
      },
      'motorista vinculado ao veiculo do aparelho'
    );

    return {
      deviceId,
      vehicleId,
      driver,
      payoutMinPercent: this.piso(),
    };
  }

  async desvincular(
    deviceId: string,
    audit: FleetAuditContext
  ): Promise<VinculoDeMotorista> {
    const vehicleId = await this.exigirVeiculo(deviceId);

    await this.vehicles.updateOne({ vehicleId }, { $set: { driverId: null } });

    await this.bindingAudit.append(
      { action: 'driver_unbind', vehicleId, deviceId },
      audit
    );

    /**
     * O tablete continua veiculando depois disto, e e o comportamento certo: desvincular
     * motorista nao e tirar o veiculo de operacao. A receita continua sendo faturada e
     * aparece como `unattributedPlays` no relatorio de conferencia, que e o que permite
     * alguem notar que falta vinculo.
     */
    this.logger.info(
      { ...audit, event: 'motorista.desvinculado', deviceId, vehicleId },
      'motorista desvinculado; veiculacao continua sem atribuicao'
    );

    return {
      deviceId,
      vehicleId,
      driver: null,
      payoutMinPercent: this.piso(),
    };
  }
}

import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { compare, hash } from 'bcryptjs';
import { randomBytes, randomUUID, createHash } from 'crypto';
import { Model } from 'mongoose';
import type {
  PairingBindResponse,
  PairingRegisterResponse,
  PairingSecretResponse,
} from '@openad/api-contracts';
import { PinoLogger } from 'nestjs-pino';
import { RabbitmqTabletCredentialsService } from '../../infrastructure/rabbitmq/rabbitmq-tablet-credentials.service';
import { DevicesRepository } from './devices.repository';
import { PairingAuditService } from './pairing-audit.service';
import type { RegisterInventoryDeviceDto } from './dto/register-inventory-device.dto';
import type { PairingBindDto, PairingRegisterDto } from './dto/pairing.dto';
import {
  hardwareFingerprintHash,
  isFingerprintUnavailable,
  type HardwareFingerprintInput,
} from './hardware-fingerprint.util';
import {
  PairingRequestRecord,
  type PairingRequestDocument,
} from './schemas/pairing-request.schema';
import {
  PairingSecretRecord,
  type PairingSecretDocument,
} from './schemas/pairing-secret.schema';

const DISPLAY_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SECRET_TTL_MS_DEFAULT = 10 * 60 * 1000;

@Injectable()
export class PairingService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly devices: DevicesRepository,
    private readonly jwt: JwtService,
    private readonly audit: PairingAuditService,
    private readonly tabletMqtt: RabbitmqTabletCredentialsService,
    @InjectModel(PairingRequestRecord.name)
    private readonly pairingRequests: Model<PairingRequestDocument>,
    @InjectModel(PairingSecretRecord.name)
    private readonly pairingSecrets: Model<PairingSecretDocument>
  ) {
    this.logger.setContext(PairingService.name);
  }

  private ttlMs(): number {
    const raw = (process.env.PAIRING_SECRET_TTL_MS ?? '').trim();
    if (raw) {
      const n = Number(raw);
      if (!Number.isNaN(n) && n > 0) return n;
    }
    return SECRET_TTL_MS_DEFAULT;
  }

  /**
   * Registra o tablet, de forma **idempotente por hardware**.
   *
   * A versao anterior gerava um `deviceId` aleatorio a cada chamada e so depois tentava
   * inserir em `devices`. Como `serialNumber` tem indice unico, o segundo registro do mesmo
   * tablet colidia (11000) e devolvia 409 — mas a linha de `pairing_requests` **ja havia
   * sido criada** e nao era desfeita. Resultado medido em producao: 5 solicitacoes `Pending`
   * orfas, todas com a mesma impressao digital, apontando para `deviceId` sem aparelho
   * nenhum; a fila de pendentes (que le de `devices`) aparecia vazia, o aparelho real estava
   * `Active`, e o tablet reinstalado nao tinha como obter um `deviceId` utilizavel. Beco sem
   * saida, e nada na tela explicava.
   *
   * Agora o hardware e a identidade: o mesmo aparelho reaproveita o proprio registro, e a
   * solicitacao pendente e uma so. A ordem tambem mudou — aparelho primeiro, solicitacao
   * depois — para que falha de insercao nao deixe rastro.
   *
   * Aparelho ja `Active` **nao** volta sozinho para `Pending`: esta rota e publica, e deixar
   * o reset aqui permitiria que qualquer um que soubesse o numero de serie tirasse um tablet
   * do ar. A recusa carrega codigo e `deviceId` para o operador agir pela rota autenticada
   * de reinicio de pareamento.
   */
  async register(dto: PairingRegisterDto): Promise<PairingRegisterResponse> {
    const fpIn: HardwareFingerprintInput = {
      imei: dto.hardwareFingerprint.imei,
      serialNumber: dto.hardwareFingerprint.serialNumber,
      macAddress: dto.hardwareFingerprint.macAddress,
    };
    const fpHash = hardwareFingerprintHash(fpIn);
    const unavailable = isFingerprintUnavailable(fpIn);
    const serial = fpIn.serialNumber || '';

    const existente = await this.acharAparelhoDoHardware({
      clientDeviceId: dto.clientDeviceId,
      fpHash,
      serial,
    });

    if (existente) {
      if (existente.lifecycleState !== 'Pending') {
        throw new ConflictException({
          error: {
            code: 'DEVICE_ALREADY_REGISTERED',
            message:
              `Este aparelho ja esta registrado como ${existente.lifecycleState}. ` +
              'Um operador precisa reiniciar o pareamento ou excluir o registro.',
            deviceId: existente.deviceId,
            lifecycleState: existente.lifecycleState,
          },
        });
      }

      // Pendente: reaproveita e garante **uma** solicitacao aberta.
      await this.garantirSolicitacaoPendente(existente.deviceId, fpHash, unavailable);
      await this.devices.updateOne(
        { deviceId: existente.deviceId },
        { $set: { hardwareFingerprintHash: fpHash, lastSeenAt: new Date() } }
      );
      this.logger.info(
        { event: 'pairing.register.reaproveitado', deviceId: existente.deviceId },
        'pairing register reused existing pending device'
      );
      return {
        deviceId: existente.deviceId,
        status: 'Pending',
        flags: unavailable ? ['FINGERPRINT_UNAVAILABLE'] : undefined,
      };
    }

    const deviceId = dto.clientDeviceId ?? randomUUID();
    const now = new Date();
    const placeholderProfile = {
      screenWidthPx: 0,
      screenHeightPx: 0,
      screenSizeInches: 0,
      osVersion: 'pending',
      storageCapacityGb: 0,
    };

    // Aparelho primeiro: se isto falhar, nao ha solicitacao orfa para limpar depois.
    try {
      await this.devices.create({
        deviceId,
        serialNumber: serial || `pending-${deviceId.slice(0, 8)}`,
        lifecycleState: 'Pending',
        groupId: null,
        boundVehicleId: null,
        boundAt: null,
        hardwareProfile: placeholderProfile,
        capabilityManifest: null,
        mqttClientId: deviceId,
        certificateThumbprint: createHash('sha256')
          .update(`pairing:${deviceId}`)
          .digest('hex'),
        lastSeenAt: now,
        lastHealthMetrics: null,
        hardwareFingerprintHash: fpHash,
        lastManifestVersion: 0,
        pairingCompletedAt: null,
        mqttCredentialsRotatedAt: null,
      });
    } catch (e: unknown) {
      if (
        e &&
        typeof e === 'object' &&
        'code' in e &&
        (e as { code: number }).code === 11000
      ) {
        /**
         * Corrida entre dois registros do mesmo tablet (o player repete o registro quando a
         * rede oscila). Quem perdeu a corrida le o vencedor e segue, em vez de devolver erro
         * para um aparelho que esta corretamente registrado.
         */
        const vencedor = await this.acharAparelhoDoHardware({
          clientDeviceId: undefined,
          fpHash,
          serial,
        });
        if (vencedor && vencedor.lifecycleState === 'Pending') {
          await this.garantirSolicitacaoPendente(vencedor.deviceId, fpHash, unavailable);
          return {
            deviceId: vencedor.deviceId,
            status: 'Pending',
            flags: unavailable ? ['FINGERPRINT_UNAVAILABLE'] : undefined,
          };
        }
        throw new ConflictException({
          error: {
            code: 'DEVICE_ALREADY_REGISTERED',
            message:
              'Este aparelho ja esta registrado. Um operador precisa reiniciar o ' +
              'pareamento ou excluir o registro.',
            deviceId: vencedor?.deviceId ?? null,
            lifecycleState: vencedor?.lifecycleState ?? null,
          },
        });
      }
      throw e;
    }

    await this.garantirSolicitacaoPendente(deviceId, fpHash, unavailable);

    this.logger.info({ event: 'pairing.register', deviceId }, 'pairing register');

    return {
      deviceId,
      status: 'Pending',
      flags: unavailable ? ['FINGERPRINT_UNAVAILABLE'] : undefined,
    };
  }

  /**
   * Acha o aparelho deste hardware. A ordem importa: `clientDeviceId` quando o tablet ainda
   * lembra o seu, depois impressao digital, depois numero de serie — que e a chave do indice
   * unico e, portanto, o que de fato impede duplicata.
   */
  private async acharAparelhoDoHardware(params: {
    clientDeviceId: string | undefined;
    fpHash: string;
    serial: string;
  }) {
    if (params.clientDeviceId) {
      const porId = await this.devices.findByDeviceId(params.clientDeviceId);
      if (porId) return porId;
    }
    if (params.fpHash) {
      const porFp = await this.devices.findOne({
        hardwareFingerprintHash: params.fpHash,
      });
      if (porFp) return porFp;
    }
    if (params.serial) {
      const porSerial = await this.devices.findBySerial(params.serial);
      if (porSerial) return porSerial;
    }
    return null;
  }

  /**
   * Garante exatamente **uma** solicitacao `Pending` para o aparelho.
   *
   * Sem isto, cada tentativa do tablet somava uma linha e a fila do operador enchia de
   * duplicatas do mesmo aparelho — foi o que aconteceu em producao.
   */
  private async garantirSolicitacaoPendente(
    deviceId: string,
    fpHash: string,
    unavailable: boolean
  ): Promise<void> {
    const flags = unavailable ? ['FINGERPRINT_UNAVAILABLE'] : [];
    const existente = await this.pairingRequests
      .findOne({ deviceId, status: 'Pending' })
      .exec();
    if (existente) {
      existente.hardwareFingerprintHash = fpHash;
      existente.flags = flags;
      await existente.save();
      return;
    }
    await this.pairingRequests.create({
      requestId: randomUUID(),
      deviceId,
      hardwareFingerprintHash: fpHash,
      status: 'Pending',
      expiresAt: null,
      flags,
    });
  }

  /**
   * Operador devolve o aparelho para `Pending`, para poder parear de novo.
   *
   * E o caso comum de campo: tablet reinstalado, trocado de veiculo ou com dados limpos. Sem
   * isto o aparelho fica preso em `Active` — `generateSecret` exige `Pending` — e nao havia
   * nenhuma saida pela interface.
   *
   * Invalida os segredos abertos e o vinculo de pareamento. **Nao** desvincula do veiculo: se
   * o tablet volta para o mesmo carro, manter o vinculo evita refazer trabalho; desvincular e
   * uma acao separada e explicita.
   */
  async reiniciarPareamento(deviceId: string): Promise<{
    deviceId: string;
    lifecycleState: 'Pending';
    anterior: string;
  }> {
    const device = await this.devices.findByDeviceId(deviceId);
    if (!device) {
      throw new NotFoundException('Device not found');
    }
    const anterior = device.lifecycleState;

    /**
     * Invalida os segredos **deste** aparelho, e so dele.
     *
     * O filtro por `requestId` nao e detalhe: um `updateMany({ usedAt: null })` sem escopo
     * queimaria o codigo de qualquer outro tablet em pareamento naquele instante, e o
     * tecnico do outro carro veria `SECRET_REPLAY` sem ter feito nada.
     */
    const anteriores = await this.pairingRequests.find({ deviceId }).exec();
    const requestIdsAnteriores = anteriores.map((r) => r.requestId);
    if (requestIdsAnteriores.length) {
      await this.pairingSecrets
        .updateMany(
          { requestId: { $in: requestIdsAnteriores }, usedAt: null },
          { $set: { usedAt: new Date() } }
        )
        .exec();
    }

    await this.pairingRequests
      .updateMany({ deviceId, status: 'Pending' }, { $set: { status: 'Cancelled' } })
      .exec();

    await this.pairingRequests.create({
      requestId: randomUUID(),
      deviceId,
      hardwareFingerprintHash: device.hardwareFingerprintHash ?? '',
      status: 'Pending',
      expiresAt: null,
      flags: [],
    });

    await this.devices.updateOne(
      { deviceId },
      {
        $set: {
          lifecycleState: 'Pending',
          pairingCompletedAt: null,
          mqttCredentialsRotatedAt: null,
        },
      }
    );

    this.logger.info(
      { event: 'pairing.reset', deviceId, anterior },
      'pairing reset by operator'
    );

    return { deviceId, lifecycleState: 'Pending', anterior };
  }

  /**
   * Remove o registro do aparelho e os rastros de pareamento.
   *
   * Recusa aparelho vinculado a veiculo: apagar sem desvincular deixaria o veiculo
   * apontando para um `deviceId` inexistente, e o painel de frota passaria a mostrar um
   * aparelho fantasma. Desvincular e decisao separada, e deliberada.
   */
  async excluirRegistro(deviceId: string): Promise<{
    deviceId: string;
    solicitacoesRemovidas: number;
  }> {
    const device = await this.devices.findByDeviceId(deviceId);
    if (!device) {
      throw new NotFoundException('Device not found');
    }
    if (device.boundVehicleId) {
      throw new ConflictException({
        error: {
          code: 'DEVICE_BOUND',
          message:
            'Aparelho vinculado a um veiculo. Desvincule antes de excluir o registro.',
          boundVehicleId: device.boundVehicleId,
        },
      });
    }

    const requisicoes = await this.pairingRequests.find({ deviceId }).exec();
    const requestIds = requisicoes.map((r) => r.requestId);
    if (requestIds.length) {
      await this.pairingSecrets
        .deleteMany({ requestId: { $in: requestIds } })
        .exec();
    }
    await this.pairingRequests.deleteMany({ deviceId }).exec();
    await this.devices.deleteOne({ deviceId });

    this.logger.warn(
      {
        event: 'pairing.device_deleted',
        deviceId,
        serialNumber: device.serialNumber,
        solicitacoesRemovidas: requestIds.length,
      },
      'device registration deleted by operator'
    );

    return { deviceId, solicitacoesRemovidas: requestIds.length };
  }

  /**
   * Limpa solicitacoes `Pending` que apontam para `deviceId` sem aparelho.
   *
   * Sao os orfaos criados pelo defeito de ordem de insercao descrito em `register`. Existe
   * como rota de manutencao porque producao ja tem esses registros, e eles enchem a fila do
   * operador com aparelhos que nao existem.
   */
  async limparSolicitacoesOrfas(): Promise<{ removidas: number; deviceIds: string[] }> {
    const pendentes = await this.pairingRequests.find({ status: 'Pending' }).exec();
    const orfas: string[] = [];
    for (const r of pendentes) {
      const existe = await this.devices.findByDeviceId(r.deviceId);
      if (!existe) orfas.push(r.requestId);
    }
    if (!orfas.length) return { removidas: 0, deviceIds: [] };

    const docs = await this.pairingRequests
      .find({ requestId: { $in: orfas } })
      .exec();
    const deviceIds = [...new Set(docs.map((d) => d.deviceId))];

    await this.pairingSecrets.deleteMany({ requestId: { $in: orfas } }).exec();
    await this.pairingRequests.deleteMany({ requestId: { $in: orfas } }).exec();

    this.logger.warn(
      { event: 'pairing.orphans_cleaned', removidas: orfas.length },
      'orphan pairing requests removed'
    );

    return { removidas: orfas.length, deviceIds };
  }

  /**
   * Fleet UI: register a tablet in inventory by serial only (Pending, unbound).
   * Screen dimensions are filled when the tablet completes pairing / handshake.
   */
  async registerInventoryDevice(
    dto: RegisterInventoryDeviceDto
  ): Promise<PairingRegisterResponse> {
    const serial = dto.serialNumber.trim();
    const existingSerial = await this.devices.findBySerial(serial);
    if (existingSerial) {
      throw new ConflictException('Serial number already registered');
    }

    const fpIn: HardwareFingerprintInput = {
      imei: null,
      serialNumber: serial,
      macAddress: '',
    };
    const fpHash = hardwareFingerprintHash(fpIn);
    const unavailable = isFingerprintUnavailable(fpIn);

    const deviceId = randomUUID();
    const requestId = randomUUID();
    const now = new Date();
    const placeholderProfile = {
      screenWidthPx: 0,
      screenHeightPx: 0,
      screenSizeInches: dto.screenSizeInches ?? 0,
      osVersion: dto.osVersion?.trim() || 'pending',
      storageCapacityGb: dto.storageCapacityGb ?? 0,
    };

    await this.pairingRequests.create({
      requestId,
      deviceId,
      hardwareFingerprintHash: fpHash,
      status: 'Pending',
      expiresAt: null,
      flags: unavailable ? ['FINGERPRINT_UNAVAILABLE'] : [],
    });

    try {
      await this.devices.create({
        deviceId,
        serialNumber: serial,
        lifecycleState: 'Pending',
        groupId: null,
        boundVehicleId: null,
        boundAt: null,
        hardwareProfile: placeholderProfile,
        capabilityManifest: null,
        mqttClientId: deviceId,
        certificateThumbprint: createHash('sha256')
          .update(`pairing:${deviceId}`)
          .digest('hex'),
        lastSeenAt: now,
        lastHealthMetrics: null,
        hardwareFingerprintHash: fpHash,
        lastManifestVersion: 0,
        pairingCompletedAt: null,
        mqttCredentialsRotatedAt: null,
      });
    } catch (e: unknown) {
      if (
        e &&
        typeof e === 'object' &&
        'code' in e &&
        (e as { code: number }).code === 11000
      ) {
        throw new ConflictException('Serial number already registered');
      }
      throw e;
    }

    this.logger.info(
      { event: 'devices.inventory_register', deviceId, serial },
      'inventory register'
    );

    return {
      deviceId,
      status: 'Pending',
      flags: unavailable ? ['FINGERPRINT_UNAVAILABLE'] : undefined,
    };
  }

  async generateSecret(deviceId: string): Promise<PairingSecretResponse> {
    const device = await this.devices.findByDeviceId(deviceId);
    if (!device) {
      throw new NotFoundException('Device not found');
    }
    if (device.lifecycleState !== 'Pending') {
      throw new ConflictException('Device not pending pairing');
    }

    const pr = await this.pairingRequests
      .findOne({ deviceId, status: 'Pending' })
      .exec();
    if (!pr) {
      throw new NotFoundException('Pairing request not found');
    }

    const displayCode = this.randomDisplayCode();
    const secretHash = await hash(displayCode, 10);
    const ttlMs = this.ttlMs();
    const ttlExpiresAt = new Date(Date.now() + ttlMs);

    await this.pairingSecrets.create({
      secretId: randomUUID(),
      requestId: pr.requestId,
      hash: secretHash,
      displayCode,
      ttlExpiresAt,
      usedAt: null,
    });

    return {
      displayCode,
      expiresAt: ttlExpiresAt.toISOString(),
    };
  }

  async bind(dto: PairingBindDto): Promise<PairingBindResponse> {
    const fpIn: HardwareFingerprintInput = {
      imei: dto.hardwareFingerprint.imei,
      serialNumber: dto.hardwareFingerprint.serialNumber,
      macAddress: dto.hardwareFingerprint.macAddress,
    };
    const fpHash = hardwareFingerprintHash(fpIn);

    const device = await this.devices.findByDeviceId(dto.deviceId);
    if (!device) {
      await this.audit.record({
        deviceId: dto.deviceId,
        fingerprintHash: fpHash,
        outcome: 'failure',
        detail: 'device_not_found',
      });
      throw new NotFoundException('Device not found');
    }

    if (device.hardwareFingerprintHash !== fpHash) {
      await this.audit.record({
        deviceId: dto.deviceId,
        fingerprintHash: fpHash,
        outcome: 'hardware_mismatch',
      });
      throw new ForbiddenException({
        error: { code: 'HARDWARE_MISMATCH', message: 'Fingerprint mismatch' },
      });
    }

    const pr = await this.pairingRequests
      .findOne({ deviceId: dto.deviceId, status: 'Pending' })
      .exec();
    if (!pr) {
      await this.audit.record({
        deviceId: dto.deviceId,
        fingerprintHash: fpHash,
        outcome: 'failure',
        detail: 'no_pending_request',
      });
      throw new NotFoundException('Pairing request not found');
    }

    const now = new Date();
    const unused = await this.pairingSecrets
      .find({ requestId: pr.requestId, usedAt: null })
      .exec();

    let matched: PairingSecretDocument | null = null;
    for (const s of unused) {
      if (s.ttlExpiresAt.getTime() < now.getTime()) {
        continue;
      }
      if (await compare(dto.secretCode, s.hash)) {
        matched = s;
        break;
      }
    }

    if (!matched) {
      const usedBefore = await this.pairingSecrets
        .findOne({ requestId: pr.requestId, usedAt: { $ne: null } })
        .exec();
      if (usedBefore) {
        await this.audit.record({
          deviceId: dto.deviceId,
          fingerprintHash: fpHash,
          outcome: 'replay',
        });
        throw new ForbiddenException({
          error: { code: 'SECRET_REPLAY', message: 'Secret already used' },
        });
      }
      const stillValid = unused.some(
        (s) => s.ttlExpiresAt.getTime() >= now.getTime()
      );
      if (!stillValid) {
        await this.audit.record({
          deviceId: dto.deviceId,
          fingerprintHash: fpHash,
          outcome: 'expired',
        });
        throw new ForbiddenException({
          error: { code: 'SECRET_EXPIRED', message: 'Secret expired' },
        });
      }
      await this.audit.record({
        deviceId: dto.deviceId,
        fingerprintHash: fpHash,
        outcome: 'failure',
        detail: 'bad_secret',
      });
      throw new ForbiddenException({
        error: { code: 'SECRET_INVALID', message: 'Invalid secret' },
      });
    }

    /**
     * As credenciais do broker sao provisionadas **antes** de qualquer efeito colateral.
     *
     * A ordem anterior era: queimar o segredo, marcar a solicitacao `Bound`, o aparelho
     * `Active`, e so depois provisionar — lancando 503 em caso de falha. O resultado medido
     * em producao: o provisionamento falhava com `tags_not_present`, o servidor ja tinha
     * gravado "pareado", o cliente recebia 503 e nunca guardava a sessao, e a tentativa
     * seguinte respondia `no_pending_request` porque a solicitacao ja estava `Bound`. Estado
     * dividido entre os dois lados, sem caminho de volta pela interface.
     *
     * Provisionando primeiro, falha nao deixa rastro: o segredo continua valido e o tecnico
     * tenta de novo com o mesmo codigo.
     */
    let mqttUser = '';
    let mqttPass = '';
    if (this.tabletMqtt.provisioningEnabled()) {
      try {
        const creds = await this.tabletMqtt.provision(dto.deviceId);
        mqttUser = creds.username;
        mqttPass = creds.password;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.error(
          {
            deviceId: dto.deviceId,
            err: msg,
            event: 'pairing.mqtt_provision_failed',
          },
          'RabbitMQ tablet credential provisioning failed'
        );
        throw new ServiceUnavailableException({
          error: {
            code: 'MQTT_PROVISION_FAILED',
            message:
              'Nao foi possivel criar as credenciais do broker para este aparelho. ' +
              'O pareamento NAO foi concluido; o codigo continua valido para nova tentativa.',
          },
        });
      }
    } else {
      mqttUser = (process.env.MQTT_DEVICE_USER ?? '').trim();
      mqttPass = (process.env.MQTT_DEVICE_PASS ?? '').trim();
    }

    matched.usedAt = now;
    await matched.save();

    pr.status = 'Bound';
    await pr.save();

    const completedAt = new Date();
    await this.devices.updateOne(
      { deviceId: dto.deviceId },
      {
        $set: {
          lifecycleState: 'Active',
          pairingCompletedAt: completedAt,
        },
      }
    );

    const accessToken = this.jwt.sign(
      {
        sub: dto.deviceId,
        typ: 'device',
        fp: fpHash,
      },
      { expiresIn: '365d' }
    );

    /**
     * Endereco do broker **para o aparelho**, que nao e o mesmo que a API usa.
     *
     * `MQTT_URL` em producao e `mqtt://...@openad-rabbitmq:1883` — nome de host interno da
     * rede Docker, que o tablet no carro nao resolve. `MQTT_PUBLIC_BROKER_URL`
     * (`wss://mqtt.opendriver.com.br/ws`) e o endereco publico, e e ele que tem de ir na
     * resposta do pareamento. Entregar o interno faria o tablet parear com sucesso e nunca
     * conectar no broker, sem erro visivel no pareamento.
     */
    const brokerUrl =
      (process.env.MQTT_PUBLIC_BROKER_URL ?? '').trim() ||
      (process.env.MQTT_URL ?? '').trim() ||
      'mqtt://openad:openad-dev-mqtt@127.0.0.1:1884';

    await this.devices.updateOne(
      { deviceId: dto.deviceId },
      { $set: { mqttCredentialsRotatedAt: new Date() } }
    );

    const publicBase =
      (process.env.PUBLIC_API_BASE_URL ?? '').trim() ||
      `http://127.0.0.1:${(process.env.PORT ?? '3000').trim() || '3000'}`;

    await this.audit.record({
      deviceId: dto.deviceId,
      fingerprintHash: fpHash,
      outcome: 'success',
    });

    return {
      deviceId: dto.deviceId,
      accessToken,
      mqtt: {
        brokerUrl,
        username: mqttUser,
        password: mqttPass,
        clientId: dto.deviceId,
      },
      manifestUrl: `${publicBase.replace(/\/$/, '')}/api/v1/devices/${encodeURIComponent(dto.deviceId)}/manifest`,
      manifestVersion: device.lastManifestVersion ?? 0,
    };
  }

  private randomDisplayCode(): string {
    let out = '';
    const buf = randomBytes(16);
    for (let i = 0; i < 8; i++) {
      out += DISPLAY_CODE_CHARS[buf[i]! % DISPLAY_CODE_CHARS.length];
    }
    return out;
  }
}

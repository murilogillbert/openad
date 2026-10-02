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

  async register(dto: PairingRegisterDto): Promise<PairingRegisterResponse> {
    const fpIn: HardwareFingerprintInput = {
      imei: dto.hardwareFingerprint.imei,
      serialNumber: dto.hardwareFingerprint.serialNumber,
      macAddress: dto.hardwareFingerprint.macAddress,
    };
    const fpHash = hardwareFingerprintHash(fpIn);
    const unavailable = isFingerprintUnavailable(fpIn);

    if (dto.clientDeviceId) {
      const existing = await this.devices.findByDeviceId(dto.clientDeviceId);
      if (existing && existing.lifecycleState === 'Active') {
        throw new ConflictException('Device already active');
      }
    }

    const deviceId = dto.clientDeviceId ?? randomUUID();
    const requestId = randomUUID();

    const now = new Date();
    const placeholderProfile = {
      screenWidthPx: 0,
      screenHeightPx: 0,
      screenSizeInches: 0,
      osVersion: 'pending',
      storageCapacityGb: 0,
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
        serialNumber: fpIn.serialNumber || `pending-${deviceId.slice(0, 8)}`,
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
        throw new ConflictException('Device id already registered');
      }
      throw e;
    }

    this.logger.info({ event: 'pairing.register', deviceId }, 'pairing register');

    return {
      deviceId,
      status: 'Pending',
      flags: unavailable ? ['FINGERPRINT_UNAVAILABLE'] : undefined,
    };
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

    const brokerUrl =
      (process.env.MQTT_URL ?? '').trim() ||
      'mqtt://openad:openad-dev-mqtt@127.0.0.1:1884';

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
        throw new ServiceUnavailableException(
          'Could not provision MQTT credentials for this device. Check RabbitMQ Management API configuration and broker health.'
        );
      }
    } else {
      mqttUser = (process.env.MQTT_DEVICE_USER ?? '').trim();
      mqttPass = (process.env.MQTT_DEVICE_PASS ?? '').trim();
    }

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

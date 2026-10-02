import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateRolloutDto } from './dto/create-rollout.dto';
import { PatchRolloutDto } from './dto/patch-rollout.dto';
import { UploadReleaseBodyDto } from './dto/upload-release-body.dto';
import { ReleasePublicationService } from './services/release-publication.service';
import { ReleaseAuditService } from './services/release-audit.service';
import { ReleasesService } from './services/releases.service';

type JwtUser = { userId: string; email: string; role: string };

@ApiTags('releases')
@Controller('releases')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('super_admin')
@ApiBearerAuth()
export class ReleasesAdminController {
  constructor(
    private readonly releases: ReleasesService,
    private readonly publication: ReleasePublicationService,
    private readonly audit: ReleaseAuditService
  ) {}

  @Get()
  @ApiOperation({ summary: 'List recent APK releases' })
  async list() {
    const rows = await this.releases.listRecent(100);
    return rows.map((r) => ({
      _id: String(r._id),
      versionIdentifier: r.versionIdentifier,
      createdAt: (r as unknown as { createdAt?: Date }).createdAt ?? null,
      status: r.status,
      uploadedByUserId: r.uploadedByUserId,
      uploadedBy: r.uploadedBy ?? null,
      installedCount: r.installedCount,
      isLatestStable: r.isLatestStable,
      hasStagedRollout: r.hasStagedRollout,
      // releaseNotes must never appear on public endpoints; this is admin-only.
      releaseNotes: r.releaseNotes ?? null,
    }));
  }

  @Get('metrics')
  @ApiOperation({
    summary: 'Fleet app update metrics (latest stable reach + pending + rollouts)',
  })
  mdmMetrics() {
    return this.releases.getMdmMetrics();
  }

  @Post('upload')
  @Throttle({ upload: { limit: 5, ttl: 60_000 } })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'versionIdentifier'],
      properties: {
        file: { type: 'string', format: 'binary' },
        versionIdentifier: { type: 'string' },
        buildNumber: { type: 'integer' },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 512 * 1024 * 1024 },
    })
  )
  @ApiOperation({ summary: 'Upload signed APK release' })
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: UploadReleaseBodyDto,
    @Req() req: Request
  ) {
    if (!file?.buffer) {
      throw new BadRequestException('file is required');
    }
    const u = req.user as JwtUser | undefined;
    if (!u?.userId) {
      throw new BadRequestException('User context required');
    }
    return this.releases.createReleaseFromUpload({
      buffer: file.buffer,
      originalFilename: file.originalname,
      versionIdentifier: body.versionIdentifier,
      buildNumber: body.buildNumber ?? null,
      releaseNotes: body.releaseNotes ?? null,
      uploadedByUserId: u.userId,
    });
  }

  @Post(':releaseId/publish-stable')
  @ApiOperation({ summary: 'Publish release as latest stable (QR + baseline channel)' })
  async publishStable(
    @Param('releaseId') releaseId: string,
    @Req() req: Request
  ) {
    const u = req.user as JwtUser | undefined;
    if (!u?.userId) {
      throw new BadRequestException('User context required');
    }
    return this.publication.publishLatestStable({
      releaseId,
      publishedByUserId: u.userId,
    });
  }

  @Post(':releaseId/revoke')
  @ApiOperation({ summary: 'Retire a release (archive); blocks if it is current latest stable' })
  async revokeRelease(
    @Param('releaseId') releaseId: string,
    @Req() req: Request
  ) {
    const u = req.user as JwtUser | undefined;
    if (!u?.userId) {
      throw new BadRequestException('User context required');
    }
    return this.releases.revokeRelease(releaseId, u.userId);
  }

  @Get('stable-cheatsheet.pdf')
  @ApiOperation({ summary: 'Download printable QR cheat-sheet PDF for installers' })
  async stableCheatSheetPdf(@Res() res: Response) {
    const m = await this.releases.getLatestStableManifest();
    const url = m?.latest?.downloadUrl;
    if (!url) {
      res.status(404).json({ message: 'No stable release published' });
      return;
    }

    const payload = {
      'android.app.extra.PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME':
        'com.openad/com.openad.OpenAdDeviceAdminReceiver',
      'android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION': url,
      'android.app.extra.PROVISIONING_LEAVE_ALL_SYSTEM_APPS_ENABLED': true,
    };
    const png = await QRCode.toBuffer(JSON.stringify(payload), {
      type: 'png',
      width: 520,
      margin: 2,
    });

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (d) => chunks.push(d as Buffer));
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    doc.fontSize(18).text('OpenAD Tablet Provisioning (Latest Stable)', { align: 'left' });
    doc.moveDown(0.5);
    doc
      .fontSize(11)
      .fillColor('#333333')
      .text('Scan this QR on a factory-reset Android tablet to enroll and install the current stable app.');
    doc.moveDown(1);

    doc.image(png, { fit: [360, 360], align: 'center' });
    doc.moveDown(1);

    doc.fontSize(12).fillColor('#111111').text('3-step setup', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(11).fillColor('#333333');
    doc.text('1) Factory reset the tablet.');
    doc.text('2) On the welcome/setup screen, choose QR provisioning and scan this code.');
    doc.text('3) Wait for enrollment and the OpenAD app to install; keep Wi‑Fi connected.');

    doc.end();

    const pdf = await done;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="openad-provisioning-qr.pdf"');
    res.status(200).send(pdf);
  }

  @Post(':releaseId/rollouts')
  @ApiOperation({ summary: 'Create staged rollout for a release' })
  async createRollout(
    @Param('releaseId') releaseId: string,
    @Body() dto: CreateRolloutDto,
    @Req() req: Request
  ) {
    const u = req.user as JwtUser | undefined;
    if (!u?.userId) {
      throw new BadRequestException('User context required');
    }
    return this.releases.createRollout({
      releaseId,
      deviceGroupIds: dto.deviceGroupIds ?? [],
      percentage: dto.percentage ?? null,
      actorUserId: u.userId,
    });
  }

  @Get('rollouts/list')
  @ApiOperation({ summary: 'List rollouts' })
  rollouts() {
    return this.releases.listRollouts();
  }

  @Patch('rollouts/:rolloutId')
  @ApiOperation({ summary: 'Update rollout status' })
  async patchRollout(
    @Param('rolloutId') rolloutId: string,
    @Body() dto: PatchRolloutDto,
    @Req() req: Request
  ) {
    const u = req.user as JwtUser | undefined;
    if (!u?.userId) {
      throw new BadRequestException('User context required');
    }
    const r = await this.releases.setRolloutStatus({
      rolloutId,
      status: dto.status,
      actorUserId: u.userId,
    });
    if (!r) {
      throw new BadRequestException('Rollout not found');
    }
    return r;
  }

  @Post('audit/qr-regenerate')
  @ApiOperation({ summary: 'Record QR regeneration (client refreshes provisioning payload)' })
  async qrRegenerate(@Req() req: Request) {
    const u = req.user as JwtUser | undefined;
    if (!u?.userId) {
      throw new BadRequestException('User context required');
    }
    await this.audit.record({
      actorUserId: u.userId,
      action: 'qr.regenerate',
      subjectId: null,
      metadata: {},
    });
    return { ok: true };
  }
}

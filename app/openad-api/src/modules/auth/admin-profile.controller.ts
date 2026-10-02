import {
  Body,
  BadRequestException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { randomUUID } from 'crypto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './decorators/roles.decorator';
import { UsersService } from './users.service';
import { SecurityAuditService } from './security-audit.service';
import {
  AssetStorageService,
  isR2StorageRef,
} from '../../infrastructure/storage/asset-storage.service';

type JwtUser = { userId: string; email: string; role: string };

class AdminMePatchDto {
  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsString()
  contactEmail?: string | null;

  @IsOptional()
  @IsString()
  contactPhone?: string | null;

  @IsOptional()
  @IsBoolean()
  clearPhoto?: boolean;
}

class AdminChangePasswordDto {
  @IsString()
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  newPassword!: string;
}

@ApiTags('admin', 'profile')
@Controller('admin/me')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('fleet_admin', 'super_admin')
@ApiBearerAuth()
export class AdminProfileController {
  constructor(
    private readonly users: UsersService,
    private readonly audit: SecurityAuditService,
    private readonly storage: AssetStorageService
  ) {}

  @Get()
  @HttpCode(200)
  @ApiOperation({ summary: 'Get current admin profile' })
  async me(@Req() req: Request) {
    const u = req.user as JwtUser | undefined;
    const doc = u?.userId ? await this.users.findByUserId(u.userId) : null;
    const rawPhotoUrl = doc?.photoUrl ?? null;
    const photoUrl =
      rawPhotoUrl && isR2StorageRef(rawPhotoUrl)
        ? await this.storage.getPresignedGetUrl(rawPhotoUrl, 3600)
        : rawPhotoUrl;
    return {
      userId: doc?.userId ?? u?.userId ?? null,
      email: doc?.email ?? u?.email ?? null,
      displayName: doc?.displayName ?? null,
      role: doc?.role ?? u?.role ?? null,
      contactEmail: doc?.contactEmail ?? null,
      contactPhone: doc?.contactPhone ?? null,
      photoUrl,
    };
  }

  @Patch()
  @HttpCode(200)
  @ApiOperation({ summary: 'Update current admin profile' })
  async patch(@Body() body: AdminMePatchDto, @Req() req: Request) {
    const u = req.user as JwtUser | undefined;
    if (!u?.userId) {
      throw new ForbiddenException('User context required');
    }
    if (body.clearPhoto) {
      const existing = await this.users.findByUserId(u.userId);
      const prev = existing?.photoUrl ?? null;
      if (prev && isR2StorageRef(prev)) {
        await this.storage.deleteObjectByRef(prev);
      }
    }
    await this.users.updateAdminProfile({
      userId: u.userId,
      displayName: body.displayName,
      contactEmail: body.contactEmail,
      contactPhone: body.contactPhone,
      clearPhoto: body.clearPhoto,
    });
    await this.audit.record({
      actorUserId: u.userId,
      action: 'profile.update',
      subjectId: u.userId,
    });
    return { ok: true };
  }

  @Post('photo')
  @HttpCode(200)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
    })
  )
  @ApiOperation({ summary: 'Upload/replace admin profile photo' })
  async uploadPhoto(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Request
  ) {
    const u = req.user as JwtUser | undefined;
    if (!u?.userId) {
      throw new ForbiddenException('User context required');
    }
    if (!file?.buffer?.length) {
      throw new BadRequestException('file is required');
    }
    const mime = (file.mimetype || '').toLowerCase();
    const ext =
      mime === 'image/png'
        ? 'png'
        : mime === 'image/jpeg' || mime === 'image/jpg'
          ? 'jpg'
          : mime === 'image/webp'
            ? 'webp'
            : null;
    if (!ext) {
      throw new BadRequestException('Only PNG, JPEG, or WEBP images are supported');
    }

    const existing = await this.users.findByUserId(u.userId);
    const prev = existing?.photoUrl ?? null;

    const key = `admin-profile/${u.userId}/${randomUUID()}.${ext}`;
    const storageRef = await this.storage.putObjectAtKey(key, file.buffer, mime);

    await this.users.setPhotoUrl({ userId: u.userId, photoUrl: storageRef });

    if (prev && isR2StorageRef(prev)) {
      await this.storage.deleteObjectByRef(prev);
    }

    await this.audit.record({
      actorUserId: u.userId,
      action: 'profile.photo.upload',
      subjectId: u.userId,
      metadata: { mime },
    });

    const photoUrl = await this.storage.getPresignedGetUrl(storageRef, 3600);
    return { photoUrl };
  }

  @Delete('photo')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete admin profile photo' })
  async deletePhoto(@Req() req: Request) {
    const u = req.user as JwtUser | undefined;
    if (!u?.userId) {
      throw new ForbiddenException('User context required');
    }
    const existing = await this.users.findByUserId(u.userId);
    const prev = existing?.photoUrl ?? null;
    if (prev && isR2StorageRef(prev)) {
      await this.storage.deleteObjectByRef(prev);
    }
    await this.users.setPhotoUrl({ userId: u.userId, photoUrl: null });
    await this.audit.record({
      actorUserId: u.userId,
      action: 'profile.photo.delete',
      subjectId: u.userId,
    });
    return;
  }

  @Post('change-password')
  @HttpCode(204)
  @ApiOperation({ summary: 'Change password' })
  async changePassword(@Body() body: AdminChangePasswordDto, @Req() req: Request) {
    const u = req.user as JwtUser | undefined;
    if (!u?.userId) {
      throw new ForbiddenException('User context required');
    }
    const result = await this.users.changePassword({
      userId: u.userId,
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
    });
    if (result !== 'ok') {
      throw new ForbiddenException('Current password incorrect');
    }
    await this.audit.record({
      actorUserId: u.userId,
      action: 'password.change',
      subjectId: u.userId,
    });
    return;
  }
}


import { Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './decorators/roles.decorator';
import { AdminSessionsService } from './admin-sessions.service';
import { SecurityAuditService } from './security-audit.service';

type JwtUser = { userId: string; email: string; role: string };
type JwtUserWithSession = JwtUser & { sid?: string };

@ApiTags('admin', 'sessions')
@Controller('admin/me/sessions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('fleet_admin', 'super_admin')
@ApiBearerAuth()
export class AdminSessionsController {
  constructor(
    private readonly sessions: AdminSessionsService,
    private readonly audit: SecurityAuditService
  ) {}

  @Get()
  @HttpCode(200)
  @ApiOperation({ summary: 'List current admin sessions (v1 placeholder)' })
  async list(@Req() req: Request) {
    const u = req.user as JwtUserWithSession | undefined;
    if (!u?.userId || !u.sid) {
      return { items: [] };
    }
    await this.sessions.assertActiveSession(u.sid);
    const items = await this.sessions.listSessions({
      userId: u.userId,
      currentSessionId: u.sid,
    });
    return { items };
  }

  @Post('revoke-others')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke all other sessions (v1 placeholder)' })
  async revokeOthers(@Req() req: Request) {
    const u = req.user as JwtUserWithSession | undefined;
    if (!u?.userId || !u.sid) {
      return;
    }
    await this.sessions.assertActiveSession(u.sid);
    const revokedCount = await this.sessions.revokeOtherSessions({
      userId: u.userId,
      keepSessionId: u.sid,
    });
    await this.audit.record({
      actorUserId: u.userId,
      action: 'session.revoke_others',
      subjectId: u.userId,
      metadata: { revokedCount },
    });
    return;
  }
}


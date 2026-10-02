import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { AdminSessionsService } from './admin-sessions.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: AdminSessionsService
  ) {}

  @Post('login')
  @Throttle({ login: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    const first = await this.auth.login(dto);
    const userId = (first.user as { userId?: string } | undefined)?.userId;
    if (!userId) return first;
    const label =
      (req.headers['user-agent'] as string | undefined)?.slice(0, 120) ??
      'Unknown device';
    const deviceId = (req.headers['x-openad-device-id'] as string | undefined)?.trim();
    const sid = deviceId
      ? await this.sessions.getOrCreateSessionForDevice({ userId, deviceId, label })
      : await this.sessions.createSession({ userId, label });
    return this.auth.login(dto, { sessionId: sid });
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body() dto: RefreshDto, @Req() req: Request) {
    void req;
    return this.auth.refresh(dto);
  }
}

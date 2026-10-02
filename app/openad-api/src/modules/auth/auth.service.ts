import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { UsersService } from './users.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import type { UserRole } from '@openad/domain';

export interface JwtAccessPayload {
  sub: string;
  email: string;
  role: UserRole;
  /** Admin portal session id (used for session listing/revocation). */
  sid?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService
  ) {}

  private get refreshSecret(): string {
    const s = (process.env.JWT_REFRESH_SECRET ?? '').trim();
    if (!s) {
      throw new Error('JWT_REFRESH_SECRET is required');
    }
    return s;
  }

  async login(dto: LoginDto, options?: { sessionId?: string }) {
    const user = await this.users.findByEmail(dto.email);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload: JwtAccessPayload = {
      sub: user.userId,
      email: user.email,
      role: user.role,
      sid: options?.sessionId,
    };

    const accessToken = await this.jwt.signAsync(payload);
    const refreshToken = await this.jwt.signAsync(
      { sub: user.userId, tokenUse: 'refresh', sid: options?.sessionId },
      {
        secret: this.refreshSecret,
        expiresIn: '30d',
      }
    );

    return {
      accessToken,
      refreshToken,
      user: {
        userId: user.userId,
        displayName: user.displayName,
        role: user.role,
      },
    };
  }

  async refresh(dto: RefreshDto, options?: { sessionId?: string }) {
    let sub: string;
    let sid: string | undefined;
    try {
      const decoded = await this.jwt.verifyAsync<{
        sub: string;
        tokenUse?: string;
        sid?: string;
      }>(dto.refreshToken, { secret: this.refreshSecret });
      if (decoded.tokenUse !== 'refresh') {
        throw new UnauthorizedException('Invalid refresh token');
      }
      sub = decoded.sub;
      sid = decoded.sid;
    } catch (e) {
      if (e instanceof UnauthorizedException) {
        throw e;
      }
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.users.findByUserId(sub);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const payload: JwtAccessPayload = {
      sub: user.userId,
      email: user.email,
      role: user.role,
      sid: sid ?? options?.sessionId,
    };

    const accessToken = await this.jwt.signAsync(payload);
    const refreshToken = await this.jwt.signAsync(
      { sub: user.userId, tokenUse: 'refresh', sid: sid ?? options?.sessionId },
      {
        secret: this.refreshSecret,
        expiresIn: '30d',
      }
    );

    return {
      accessToken,
      refreshToken,
      user: {
        userId: user.userId,
        displayName: user.displayName,
        role: user.role,
      },
    };
  }
}

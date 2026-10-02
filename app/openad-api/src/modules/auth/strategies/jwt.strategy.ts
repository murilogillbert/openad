import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { UserRole } from '@openad/domain';
import type { JwtAccessPayload } from '../auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    const secret = (process.env.JWT_SECRET ?? '').trim();
    if (!secret) {
      throw new Error('JWT_SECRET is required');
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  validate(payload: JwtAccessPayload): {
    userId: string;
    email: string;
    role: UserRole;
    sid?: string;
  } {
    return {
      userId: payload.sub,
      email: payload.email,
      role: payload.role,
      sid: payload.sid,
    };
  }
}

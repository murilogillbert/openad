import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { UsersService } from './users.service';

describe('AuthService', () => {
  let service: AuthService;
  let users: {
    findByEmail: jest.Mock;
    findByUserId: jest.Mock;
  };
  let jwt: { signAsync: jest.Mock; verifyAsync: jest.Mock };
  const envBefore = { ...process.env };

  beforeEach(async () => {
    process.env.JWT_REFRESH_SECRET = 'refresh-secret-test';

    users = {
      findByEmail: jest.fn(),
      findByUserId: jest.fn(),
    };
    jwt = {
      signAsync: jest.fn(),
      verifyAsync: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: users },
        { provide: JwtService, useValue: jwt },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  afterEach(() => {
    process.env = { ...envBefore };
  });

  it('login returns tokens on valid password', async () => {
    const hash = await bcrypt.hash('password123', 4);
    users.findByEmail.mockResolvedValue({
      userId: 'u1',
      email: 'a@b.com',
      passwordHash: hash,
      displayName: 'A',
      role: 'fleet_operator',
    });
    jwt.signAsync.mockResolvedValueOnce('access-token');
    jwt.signAsync.mockResolvedValueOnce('refresh-token');

    const result = await service.login({
      email: 'a@b.com',
      password: 'password123',
    });

    expect(result.accessToken).toBe('access-token');
    expect(result.refreshToken).toBe('refresh-token');
    expect(result.user.userId).toBe('u1');
    expect(jwt.signAsync).toHaveBeenCalled();
  });

  it('login rejects wrong password', async () => {
    const hash = await bcrypt.hash('other-secret', 4);
    users.findByEmail.mockResolvedValue({
      userId: 'u1',
      email: 'a@b.com',
      passwordHash: hash,
      displayName: 'A',
      role: 'fleet_operator',
    });

    await expect(
      service.login({ email: 'a@b.com', password: 'password123' })
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refresh returns new tokens when refresh token is valid', async () => {
    jwt.verifyAsync.mockResolvedValue({ sub: 'u1', tokenUse: 'refresh' });
    users.findByUserId.mockResolvedValue({
      userId: 'u1',
      email: 'a@b.com',
      passwordHash: 'x',
      displayName: 'A',
      role: 'fleet_admin',
    });
    jwt.signAsync.mockResolvedValueOnce('new-access');
    jwt.signAsync.mockResolvedValueOnce('new-refresh');

    const r = await service.refresh({ refreshToken: 'rt' });

    expect(r.accessToken).toBe('new-access');
    expect(r.refreshToken).toBe('new-refresh');
    expect(jwt.verifyAsync).toHaveBeenCalledWith('rt', {
      secret: 'refresh-secret-test',
    });
  });

  it('refresh rejects expired or invalid token', async () => {
    jwt.verifyAsync.mockRejectedValue(new Error('jwt expired'));

    await expect(service.refresh({ refreshToken: 'bad' })).rejects.toBeInstanceOf(
      UnauthorizedException
    );
  });
});

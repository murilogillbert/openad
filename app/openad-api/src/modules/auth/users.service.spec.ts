import { Model } from 'mongoose';
import type { UserDocument } from './schemas/user.schema';
import { UsersService } from './users.service';

describe('UsersService', () => {
  describe('seedAdminUser', () => {
    it('returns users_exist when collection is non-empty', async () => {
      const userModel = {
        countDocuments: jest.fn().mockReturnValue({ exec: () => Promise.resolve(2) }),
      } as unknown as Model<UserDocument>;
      const svc = new UsersService(userModel);
      await expect(svc.seedAdminUser()).resolves.toEqual({
        status: 'skipped',
        reason: 'users_exist',
      });
    });

    it('returns missing_credentials when empty and no email/password', async () => {
      const userModel = {
        countDocuments: jest.fn().mockReturnValue({ exec: () => Promise.resolve(0) }),
      } as unknown as Model<UserDocument>;
      const svc = new UsersService(userModel);
      await expect(svc.seedAdminUser()).resolves.toEqual({
        status: 'skipped',
        reason: 'missing_credentials',
      });
    });

    it('creates super_admin when empty and options provide credentials', async () => {
      const create = jest.fn().mockResolvedValue({});
      const userModel = {
        countDocuments: jest.fn().mockReturnValue({ exec: () => Promise.resolve(0) }),
        create,
      } as unknown as Model<UserDocument>;
      const svc = new UsersService(userModel);
      const r = await svc.seedAdminUser({
        email: 'A@Example.com',
        password: 'x',
        displayName: 'CLI Admin',
      });
      expect(r).toEqual({ status: 'created', email: 'a@example.com' });
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'a@example.com',
          displayName: 'CLI Admin',
          role: 'super_admin',
        })
      );
      expect(create.mock.calls[0][0].passwordHash).toBeDefined();
    });
  });
});

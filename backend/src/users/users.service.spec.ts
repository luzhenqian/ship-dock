import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { PrismaService } from '../common/prisma.service';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      user: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), delete: jest.fn(), create: jest.fn() },
      invite: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    };

    const module = await Test.createTestingModule({
      providers: [UsersService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(UsersService);
  });

  describe('createInvite', () => {
    it('creates an invite with 48h expiry', async () => {
      prisma.invite.create.mockResolvedValue({ id: '1', token: 'abc', role: 'DEVELOPER', expiresAt: new Date() });
      const result = await service.createInvite('user-1', { role: 'DEVELOPER' });
      expect(prisma.invite.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ role: 'DEVELOPER', createdById: 'user-1' }) }),
      );
      expect(result).toHaveProperty('token');
    });
  });

  describe('acceptInvite', () => {
    it('throws if invite token not found', async () => {
      prisma.invite.findUnique.mockResolvedValue(null);
      await expect(service.acceptInvite({ token: 'bad', email: 'a@b.com', password: '12345678', name: 'Test' })).rejects.toThrow(NotFoundException);
    });

    it('throws if invite is expired', async () => {
      prisma.invite.findUnique.mockResolvedValue({ id: '1', token: 'abc', role: 'DEVELOPER', usedAt: null, expiresAt: new Date('2020-01-01') });
      await expect(service.acceptInvite({ token: 'abc', email: 'a@b.com', password: '12345678', name: 'Test' })).rejects.toThrow(BadRequestException);
    });
  });

  describe('listUsers', () => {
    it('returns all users without passwords', async () => {
      prisma.user.findMany.mockResolvedValue([{ id: '1', email: 'a@b.com', name: 'A', role: 'OWNER', password: 'hash' }]);
      const result = await service.listUsers();
      expect(result[0]).not.toHaveProperty('password');
    });
  });
});

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../common/prisma.service';
import { CreateInviteDto, AcceptInviteDto } from '../auth/dto/invite.dto';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async listUsers() {
    const users = await this.prisma.user.findMany({
      select: { id: true, email: true, name: true, avatar: true, role: true, createdAt: true },
    });
    return users.map(({ password: _pw, ...rest }: any) => rest);
  }

  async updateRole(userId: string, role: string) {
    return this.prisma.user.update({
      where: { id: userId }, data: { role: role as any },
      select: { id: true, email: true, name: true, role: true },
    });
  }

  async deleteUser(userId: string) {
    return this.prisma.user.delete({ where: { id: userId } });
  }

  async createInvite(createdById: string, dto: CreateInviteDto) {
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 48);
    return this.prisma.invite.create({
      data: { email: dto.email, role: dto.role as any, expiresAt, createdById },
    });
  }

  async acceptInvite(dto: AcceptInviteDto) {
    const invite = await this.prisma.invite.findUnique({ where: { token: dto.token } });
    if (!invite) throw new NotFoundException('Invite not found');
    if (invite.usedAt) throw new BadRequestException('Invite already used');
    if (invite.expiresAt < new Date()) throw new BadRequestException('Invite expired');

    const hash = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: { email: dto.email, password: hash, name: dto.name, role: invite.role },
    });

    await this.prisma.invite.update({ where: { id: invite.id }, data: { usedAt: new Date() } });
    return { id: user.id, email: user.email, name: user.name, role: user.role };
  }
}

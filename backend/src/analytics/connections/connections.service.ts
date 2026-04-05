import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { EncryptionService } from '../../common/encryption.service';
import { AnalyticsProvider } from '@prisma/client';

export interface SaveConnectionInput {
  userId: string;
  provider: AnalyticsProvider;
  accessToken: string;
  refreshToken: string;
  tokenExpiry: Date;
  accountEmail: string;
  accountId?: string;
}

@Injectable()
export class ConnectionsService {
  constructor(
    private prisma: PrismaService,
    private encryption: EncryptionService,
  ) {}

  async findAllByUser(userId: string) {
    const connections = await this.prisma.analyticsConnection.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    return connections.map(({ accessToken, refreshToken, ...rest }) => rest);
  }

  async findById(id: string) {
    return this.prisma.analyticsConnection.findUnique({ where: { id } });
  }

  async getDecryptedTokens(id: string) {
    const conn = await this.prisma.analyticsConnection.findUnique({
      where: { id },
    });
    if (!conn) throw new NotFoundException('Connection not found');

    return {
      accessToken: this.encryption.decrypt(conn.accessToken),
      refreshToken: this.encryption.decrypt(conn.refreshToken),
      tokenExpiry: conn.tokenExpiry,
    };
  }

  async saveConnection(input: SaveConnectionInput) {
    return this.prisma.analyticsConnection.create({
      data: {
        userId: input.userId,
        provider: input.provider,
        accessToken: this.encryption.encrypt(input.accessToken),
        refreshToken: this.encryption.encrypt(input.refreshToken),
        tokenExpiry: input.tokenExpiry,
        accountEmail: input.accountEmail,
        accountId: input.accountId,
      },
    });
  }

  async updateTokens(
    id: string,
    accessToken: string,
    refreshToken: string,
    tokenExpiry: Date,
  ) {
    return this.prisma.analyticsConnection.update({
      where: { id },
      data: {
        accessToken: this.encryption.encrypt(accessToken),
        refreshToken: this.encryption.encrypt(refreshToken),
        tokenExpiry,
      },
    });
  }

  async deleteConnection(id: string, userId: string) {
    const conn = await this.prisma.analyticsConnection.findUnique({
      where: { id },
    });
    if (!conn || conn.userId !== userId) {
      throw new NotFoundException('Connection not found');
    }

    return this.prisma.analyticsConnection.delete({ where: { id } });
  }
}

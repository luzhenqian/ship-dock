import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ConnectionsService } from './connections.service';
import { Ga4OAuthService } from '../providers/ga4/ga4-oauth.service';

@Controller('analytics')
@UseGuards(JwtAuthGuard)
export class ConnectionsController {
  private redis: Redis;

  constructor(
    private connectionsService: ConnectionsService,
    private ga4OAuth: Ga4OAuthService,
    private config: ConfigService,
  ) {
    this.redis = new Redis({
      host: this.config.get('REDIS_HOST', 'localhost'),
      port: this.config.get('REDIS_PORT', 6379),
      password: this.config.get('REDIS_PASSWORD'),
    });
  }

  @Get('connections')
  findAll(@Req() req: any) {
    return this.connectionsService.findAllByUser(req.user.id);
  }

  @Delete('connections/:id')
  delete(@Param('id') id: string, @Req() req: any) {
    return this.connectionsService.deleteConnection(id, req.user.id);
  }

  @Get('connect/google')
  async connectGoogle(@Req() req: any, @Res() res: Response) {
    const state = randomUUID();
    await this.redis.set(
      `oauth:state:${state}`,
      req.user.id,
      'EX',
      600,
    );
    const url = this.ga4OAuth.getAuthUrl(state);
    res.redirect(url);
  }

  @Get('callback/google')
  async callbackGoogle(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    const userId = await this.redis.get(`oauth:state:${state}`);
    if (!userId) throw new BadRequestException('Invalid or expired OAuth state');
    await this.redis.del(`oauth:state:${state}`);

    const tokens = await this.ga4OAuth.exchangeCode(code);

    await this.connectionsService.saveConnection({
      userId,
      provider: 'GOOGLE_GA4',
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenExpiry: tokens.tokenExpiry,
      accountEmail: tokens.accountEmail,
      accountId: tokens.accountId,
    });

    const frontendUrl = this.config.get('FRONTEND_URL', 'http://localhost:3000');
    res.redirect(`${frontendUrl}/settings/analytics?connected=google`);
  }
}

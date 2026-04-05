import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ConnectionsService } from './connections.service';
import { Ga4OAuthService } from '../providers/ga4/ga4-oauth.service';
import { ClarityOAuthService } from '../providers/clarity/clarity-oauth.service';

@Controller('analytics')
export class ConnectionsController {
  private redis: Redis;

  constructor(
    private connectionsService: ConnectionsService,
    private ga4OAuth: Ga4OAuthService,
    private clarityOAuth: ClarityOAuthService,
    private config: ConfigService,
    private jwt: JwtService,
  ) {
    this.redis = new Redis({
      host: this.config.get('REDIS_HOST', 'localhost'),
      port: this.config.get('REDIS_PORT', 6379),
      password: this.config.get('REDIS_PASSWORD'),
    });
  }

  /** Verify JWT from query param (for browser redirects that can't send headers) */
  private verifyToken(token: string): { id: string; role: string } {
    try {
      const payload = this.jwt.verify(token, {
        secret: this.config.getOrThrow('JWT_SECRET'),
      });
      return { id: payload.sub, role: payload.role };
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  @Get('connections')
  @UseGuards(JwtAuthGuard)
  findAll(@Req() req: any) {
    return this.connectionsService.findAllByUser(req.user.id);
  }

  @Delete('connections/:id')
  @UseGuards(JwtAuthGuard)
  delete(@Param('id') id: string, @Req() req: any) {
    return this.connectionsService.deleteConnection(id, req.user.id);
  }

  @Get('connect/google')
  async connectGoogle(@Query('token') token: string, @Res() res: Response) {
    const user = this.verifyToken(token);
    const state = randomUUID();
    await this.redis.set(`oauth:state:${state}`, user.id, 'EX', 600);
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

  @Get('connect/microsoft')
  async connectMicrosoft(@Query('token') token: string, @Res() res: Response) {
    const user = this.verifyToken(token);
    const state = randomUUID();
    await this.redis.set(`oauth:state:${state}`, user.id, 'EX', 600);
    const url = await this.clarityOAuth.getAuthUrl(state);
    res.redirect(url);
  }

  @Get('callback/microsoft')
  async callbackMicrosoft(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    const userId = await this.redis.get(`oauth:state:${state}`);
    if (!userId) throw new BadRequestException('Invalid or expired OAuth state');
    await this.redis.del(`oauth:state:${state}`);

    const tokens = await this.clarityOAuth.exchangeCode(code);

    await this.connectionsService.saveConnection({
      userId,
      provider: 'MICROSOFT_CLARITY',
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenExpiry: tokens.tokenExpiry,
      accountEmail: tokens.accountEmail,
      accountId: tokens.accountId,
    });

    const frontendUrl = this.config.get('FRONTEND_URL', 'http://localhost:3000');
    res.redirect(`${frontendUrl}/settings/analytics?connected=microsoft`);
  }
}

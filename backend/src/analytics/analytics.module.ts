import { Module } from '@nestjs/common';
import { ConnectionsController } from './connections/connections.controller';
import { ConnectionsService } from './connections/connections.service';
import { Ga4OAuthService } from './providers/ga4/ga4-oauth.service';
import { ClarityOAuthService } from './providers/clarity/clarity-oauth.service';

@Module({
  controllers: [ConnectionsController],
  providers: [ConnectionsService, Ga4OAuthService, ClarityOAuthService],
  exports: [ConnectionsService, Ga4OAuthService, ClarityOAuthService],
})
export class AnalyticsModule {}

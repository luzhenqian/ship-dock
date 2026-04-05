import { Module } from '@nestjs/common';
import { ConnectionsController } from './connections/connections.controller';
import { ConnectionsService } from './connections/connections.service';
import { Ga4OAuthService } from './providers/ga4/ga4-oauth.service';

@Module({
  controllers: [ConnectionsController],
  providers: [ConnectionsService, Ga4OAuthService],
  exports: [ConnectionsService, Ga4OAuthService],
})
export class AnalyticsModule {}

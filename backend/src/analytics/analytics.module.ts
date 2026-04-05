import { Module } from '@nestjs/common';
import { ConnectionsController } from './connections/connections.controller';
import { ConnectionsService } from './connections/connections.service';
import { Ga4OAuthService } from './providers/ga4/ga4-oauth.service';
import { Ga4AdminService } from './providers/ga4/ga4-admin.service';
import { Ga4AdminController } from './providers/ga4/ga4-admin.controller';
import { ClarityOAuthService } from './providers/clarity/clarity-oauth.service';
import { ClarityAdminService } from './providers/clarity/clarity-admin.service';
import { ClarityAdminController } from './providers/clarity/clarity-admin.controller';

@Module({
  controllers: [ConnectionsController, Ga4AdminController, ClarityAdminController],
  providers: [ConnectionsService, Ga4OAuthService, Ga4AdminService, ClarityOAuthService, ClarityAdminService],
  exports: [ConnectionsService, Ga4OAuthService, Ga4AdminService, ClarityOAuthService, ClarityAdminService],
})
export class AnalyticsModule {}

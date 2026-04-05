import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConnectionsController } from './connections/connections.controller';
import { ConnectionsService } from './connections/connections.service';
import { Ga4OAuthService } from './providers/ga4/ga4-oauth.service';
import { Ga4AdminService } from './providers/ga4/ga4-admin.service';
import { Ga4AdminController } from './providers/ga4/ga4-admin.controller';
import { Ga4DataService } from './providers/ga4/ga4-data.service';
import { ClarityOAuthService } from './providers/clarity/clarity-oauth.service';
import { ClarityAdminService } from './providers/clarity/clarity-admin.service';
import { ClarityAdminController } from './providers/clarity/clarity-admin.controller';
import { IntegrationsService } from './integrations/integrations.service';
import { IntegrationsController } from './integrations/integrations.controller';

@Module({
  imports: [JwtModule.register({})],
  controllers: [ConnectionsController, Ga4AdminController, ClarityAdminController, IntegrationsController],
  providers: [ConnectionsService, Ga4OAuthService, Ga4AdminService, Ga4DataService, ClarityOAuthService, ClarityAdminService, IntegrationsService],
  exports: [ConnectionsService, Ga4OAuthService, Ga4AdminService, Ga4DataService, ClarityOAuthService, ClarityAdminService, IntegrationsService],
})
export class AnalyticsModule {}

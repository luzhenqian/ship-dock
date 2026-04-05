import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { CommonModule } from './common/common.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ProjectsModule } from './projects/projects.module';
import { DeployModule } from './deploy/deploy.module';
import { DomainsModule } from './domains/domains.module';
import { UploadModule } from './upload/upload.module';
import { ServicesModule } from './services/services.module';
import { LogsModule } from './logs/logs.module';
import { DatabaseBrowserModule } from './database-browser/database-browser.module';
import { RedisBrowserModule } from './redis-browser/redis-browser.module';
import { StorageBrowserModule } from './storage-browser/storage-browser.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { DataMigrationModule } from './data-migration/data-migration.module';
import { NginxConfigModule } from './nginx-config/nginx-config.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    CommonModule,
    AuthModule,
    UsersModule,
    ProjectsModule,
    DeployModule,
    DomainsModule,
    UploadModule,
    ServicesModule,
    LogsModule,
    DatabaseBrowserModule,
    RedisBrowserModule,
    StorageBrowserModule,
    WebhooksModule,
    DataMigrationModule,
    NginxConfigModule,
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get('REDIS_HOST', 'localhost'),
          port: config.get('REDIS_PORT', 6379),
          password: config.get('REDIS_PASSWORD'),
        },
      }),
    }),
  ],
})
export class AppModule {}

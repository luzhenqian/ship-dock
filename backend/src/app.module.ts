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
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get('REDIS_HOST', 'localhost'),
          port: config.get('REDIS_PORT', 6379),
        },
      }),
    }),
  ],
})
export class AppModule {}

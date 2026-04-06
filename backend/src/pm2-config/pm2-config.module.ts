import { Module } from '@nestjs/common';
import { Pm2ConfigController } from './pm2-config.controller';
import { Pm2ConfigService } from './pm2-config.service';

@Module({
  controllers: [Pm2ConfigController],
  providers: [Pm2ConfigService],
  exports: [Pm2ConfigService],
})
export class Pm2ConfigModule {}

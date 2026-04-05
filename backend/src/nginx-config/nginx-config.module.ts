import { Module } from '@nestjs/common';
import { NginxConfigController } from './nginx-config.controller';
import { NginxConfigService } from './nginx-config.service';

@Module({
  controllers: [NginxConfigController],
  providers: [NginxConfigService],
  exports: [NginxConfigService],
})
export class NginxConfigModule {}

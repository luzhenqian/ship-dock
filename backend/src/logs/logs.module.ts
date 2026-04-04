import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { LogsController } from './logs.controller';
import { LogsService } from './logs.service';
import { LogsGateway } from './logs.gateway';

@Module({
  imports: [JwtModule.register({})],
  controllers: [LogsController],
  providers: [LogsService, LogsGateway],
})
export class LogsModule {}

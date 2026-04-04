import { Global, Module } from '@nestjs/common';
import { ServicesController } from './services.controller';
import { ServicesService } from './services.service';
import { ConnectionPoolService } from './connection-pool.service';

@Global()
@Module({
  controllers: [ServicesController],
  providers: [ServicesService, ConnectionPoolService],
  exports: [ServicesService, ConnectionPoolService],
})
export class ServicesModule {}

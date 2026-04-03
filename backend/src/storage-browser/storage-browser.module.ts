import { Module } from '@nestjs/common';
import { StorageBrowserController } from './storage-browser.controller';
import { StorageBrowserService } from './storage-browser.service';

@Module({
  controllers: [StorageBrowserController],
  providers: [StorageBrowserService],
})
export class StorageBrowserModule {}

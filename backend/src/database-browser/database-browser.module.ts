import { Module } from '@nestjs/common';
import { DatabaseBrowserController } from './database-browser.controller';
import { DatabaseBrowserService } from './database-browser.service';

@Module({
  controllers: [DatabaseBrowserController],
  providers: [DatabaseBrowserService],
})
export class DatabaseBrowserModule {}

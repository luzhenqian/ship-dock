import { Module } from '@nestjs/common';
import { RedisBrowserController } from './redis-browser.controller';
import { RedisBrowserService } from './redis-browser.service';

@Module({
  controllers: [RedisBrowserController],
  providers: [RedisBrowserService],
})
export class RedisBrowserModule {}

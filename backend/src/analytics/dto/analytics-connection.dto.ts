import { IsEnum, IsString } from 'class-validator';
import { AnalyticsProvider } from '@prisma/client';

export class ConnectProviderDto {
  @IsEnum(AnalyticsProvider)
  provider: AnalyticsProvider;
}

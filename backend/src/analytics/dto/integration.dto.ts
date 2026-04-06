import { IsEnum, IsOptional, IsString, IsBoolean } from 'class-validator';
import { AnalyticsProvider } from '@prisma/client';

export class CreateIntegrationDto {
  @IsString() @IsOptional()
  connectionId?: string;

  @IsEnum(AnalyticsProvider)
  provider: AnalyticsProvider;

  @IsString() @IsOptional() ga4PropertyId?: string;
  @IsString() @IsOptional() ga4StreamId?: string;
  @IsString() @IsOptional() measurementId?: string;
  @IsString() @IsOptional() clarityProjectId?: string;
  @IsString() @IsOptional() clarityTrackingCode?: string;
}

export class UpdateIntegrationDto {
  @IsString() @IsOptional() connectionId?: string;
  @IsString() @IsOptional() ga4PropertyId?: string;
  @IsString() @IsOptional() ga4StreamId?: string;
  @IsString() @IsOptional() measurementId?: string;
  @IsString() @IsOptional() clarityProjectId?: string;
  @IsString() @IsOptional() clarityTrackingCode?: string;
  @IsBoolean() @IsOptional() enabled?: boolean;
}

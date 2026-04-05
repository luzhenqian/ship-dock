import { IsBoolean, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

export class UpdateNginxConfigDto {
  @IsOptional() @IsInt() @Min(1) @Max(1024)
  clientMaxBodySize?: number;

  @IsOptional() @IsInt() @Min(1) @Max(3600)
  proxyReadTimeout?: number;

  @IsOptional() @IsInt() @Min(1) @Max(3600)
  proxySendTimeout?: number;

  @IsOptional() @IsInt() @Min(1) @Max(3600)
  proxyConnectTimeout?: number;

  @IsOptional() @IsBoolean()
  gzipEnabled?: boolean;

  @IsOptional() @IsInt() @Min(0) @Max(1048576)
  gzipMinLength?: number;

  @IsOptional() @IsString() @Matches(/^[a-z0-9\-+./\s]+$/i, { message: 'gzipTypes must be space-separated MIME types' })
  gzipTypes?: string;

  @IsOptional() @IsBoolean()
  proxyBuffering?: boolean;

  @IsOptional() @IsString() @Matches(/^\d+[km]?$/i, { message: 'proxyBufferSize must be a size like "4k", "8k", or "16"' })
  proxyBufferSize?: string;

  @IsOptional() @IsString() @Matches(/^\d+\s+\d+[km]?$/i, { message: 'proxyBuffers must be like "8 4k" or "4 8k"' })
  proxyBuffers?: string;
}

import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

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

  @IsOptional() @IsString()
  gzipTypes?: string;

  @IsOptional() @IsBoolean()
  proxyBuffering?: boolean;

  @IsOptional() @IsString()
  proxyBufferSize?: string;

  @IsOptional() @IsString()
  proxyBuffers?: string;
}

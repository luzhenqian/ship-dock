import { IsEnum, IsOptional, ValidateNested, IsArray, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class RemoteConnectionDto {
  @IsString()
  host: string;

  @IsOptional()
  @IsString()
  port?: string;

  @IsString()
  username: string;

  @IsString()
  password: string;

  @IsString()
  database: string;
}

export class RemoteRedisDto {
  @IsString()
  url: string;
}

export class RemoteStorageDto {
  @IsString()
  endpoint: string;

  @IsString()
  accessKey: string;

  @IsString()
  secretKey: string;

  @IsString()
  bucket: string;

  @IsOptional()
  @IsString()
  region?: string;
}

export class RemoteServiceDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => RemoteConnectionDto)
  database?: RemoteConnectionDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => RemoteRedisDto)
  redis?: RemoteRedisDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => RemoteStorageDto)
  storage?: RemoteStorageDto;
}

export class CreateImportDto {
  @IsEnum(['CLI_PACKAGE', 'REMOTE'])
  sourceType: 'CLI_PACKAGE' | 'REMOTE';

  @IsOptional()
  @IsString()
  packageKey?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RemoteServiceDto)
  services?: RemoteServiceDto[];
}

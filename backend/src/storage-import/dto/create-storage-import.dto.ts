import { IsString, IsEnum, IsOptional, IsNumber, IsBoolean, IsArray, ValidateNested, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class RemoteConnectionDto {
  @IsString() endpoint: string;
  @IsNumber() @Min(1) @Max(65535) port: number;
  @IsString() accessKey: string;
  @IsString() secretKey: string;
  @IsBoolean() @IsOptional() useSSL?: boolean;
}

export class TestStorageConnectionDto {
  @ValidateNested() @Type(() => RemoteConnectionDto)
  connection: RemoteConnectionDto;
}

export class DiscoverStorageObjectsDto {
  @ValidateNested() @Type(() => RemoteConnectionDto)
  connection: RemoteConnectionDto;

  @IsString() bucket: string;
  @IsString() @IsOptional() prefix?: string;
}

export class ValidateUrlsDto {
  @IsArray() @IsString({ each: true })
  urls: string[];
}

export class CreateStorageImportDto {
  @IsEnum(['REMOTE', 'FILE', 'URL'])
  source: 'REMOTE' | 'FILE' | 'URL';

  @IsString() targetBucket: string;
  @IsString() @IsOptional() targetPrefix?: string;

  @IsEnum(['OVERWRITE', 'SKIP', 'ERROR'])
  conflictStrategy: 'OVERWRITE' | 'SKIP' | 'ERROR';

  @ValidateNested() @Type(() => RemoteConnectionDto) @IsOptional()
  connection?: RemoteConnectionDto;

  @IsString() @IsOptional() sourceBucket?: string;
  @IsArray() @IsString({ each: true }) @IsOptional()
  objectKeys?: string[];

  @IsArray() @IsString({ each: true }) @IsOptional()
  fileKeys?: string[];

  @IsArray() @IsString({ each: true }) @IsOptional()
  urls?: string[];

  @IsNumber() @IsOptional() totalFiles?: number;
  @IsNumber() @IsOptional() totalSize?: number;
}

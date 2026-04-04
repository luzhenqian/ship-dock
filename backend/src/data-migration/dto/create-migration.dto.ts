import { IsEnum, IsString, IsOptional, IsArray, ValidateNested, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class ConnectionConfigDto {
  @IsString()
  host: string;

  @IsInt() @Min(1) @Max(65535)
  port: number;

  @IsString()
  username: string;

  @IsString()
  password: string;

  @IsString()
  database: string;
}

export class TestConnectionDto {
  @ValidateNested()
  @Type(() => ConnectionConfigDto)
  connection: ConnectionConfigDto;
}

export class DiscoverTablesDto {
  @ValidateNested()
  @Type(() => ConnectionConfigDto)
  connection: ConnectionConfigDto;
}

export class SelectedTableDto {
  @IsString()
  tableName: string;

  @IsString()
  @IsOptional()
  schemaName?: string = 'public';
}

export class CreateMigrationDto {
  @IsEnum(['REMOTE', 'FILE'])
  source: 'REMOTE' | 'FILE';

  @ValidateNested()
  @Type(() => ConnectionConfigDto)
  @IsOptional()
  connection?: ConnectionConfigDto;

  @IsString()
  @IsOptional()
  fileKey?: string;

  @IsString()
  @IsOptional()
  fileName?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SelectedTableDto)
  tables: SelectedTableDto[];

  @IsEnum(['ERROR', 'OVERWRITE', 'SKIP'])
  conflictStrategy: 'ERROR' | 'OVERWRITE' | 'SKIP';
}

export class AnalyzeFileDto {
  @IsString()
  fileKey: string;
}

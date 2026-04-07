import { IsArray, ValidateNested, IsString, IsOptional, IsEnum, IsInt } from 'class-validator';
import { Type } from 'class-transformer';

export class ImportItemConfigDto {
  @IsString()
  itemId: string;

  @IsString()
  name: string;

  @IsString()
  slug: string;

  @IsOptional()
  @IsInt()
  port?: number;

  @IsOptional()
  @IsString()
  repoUrl?: string;

  @IsOptional()
  @IsString()
  branch?: string;

  @IsOptional()
  envVars?: Record<string, string>;

  @IsOptional()
  pipeline?: any;

  @IsOptional()
  @IsString()
  domain?: string;

  @IsOptional()
  @IsEnum(['ERROR', 'OVERWRITE', 'SKIP', 'APPEND'])
  dbConflictStrategy?: 'ERROR' | 'OVERWRITE' | 'SKIP' | 'APPEND';

  @IsOptional()
  cronJobs?: { schedule: string; command: string }[];

  @IsOptional()
  skipDatabase?: boolean;

  @IsOptional()
  skipRedis?: boolean;

  @IsOptional()
  skipStorage?: boolean;
}

export class SubmitImportConfigDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportItemConfigDto)
  items: ImportItemConfigDto[];
}

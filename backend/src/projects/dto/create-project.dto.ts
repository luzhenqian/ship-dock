import { IsArray, IsBoolean, IsEnum, IsInt, IsObject, IsOptional, IsString, IsUrl, Max, Min } from 'class-validator';

export class CreateProjectDto {
  @IsString()
  name: string;

  @IsString()
  slug: string;

  @IsEnum(['GITHUB', 'UPLOAD', 'STATIC'])
  sourceType: string;

  @IsUrl()
  @IsOptional()
  repoUrl?: string;

  @IsString()
  @IsOptional()
  branch?: string;

  @IsString()
  @IsOptional()
  domain?: string;

  @IsInt()
  @Min(3001)
  @Max(3999)
  @IsOptional()
  port?: number;

  @IsString()
  @IsOptional()
  directory?: string;

  @IsString()
  @IsOptional()
  workDir?: string;

  @IsString()
  @IsOptional()
  startCommand?: string;

  @IsString()
  @IsOptional()
  nodeVersion?: string;

  @IsString()
  @IsOptional()
  githubInstallationId?: string;

  @IsBoolean()
  @IsOptional()
  useLocalDb?: boolean;

  @IsBoolean()
  @IsOptional()
  useLocalRedis?: boolean;

  @IsBoolean()
  @IsOptional()
  useLocalMinio?: boolean;

  @IsObject()
  @IsOptional()
  envVars?: Record<string, string>;

  @IsObject()
  @IsOptional()
  pipeline?: { stages: any[] };

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  systemDeps?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  dbExtensions?: string[];

  @IsInt()
  @Min(1048576)
  @IsOptional()
  fileSizeLimit?: number;

  @IsInt()
  @Min(1048576)
  @IsOptional()
  fileTotalLimit?: number;
}

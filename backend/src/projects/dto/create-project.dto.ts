import { IsEnum, IsInt, IsObject, IsOptional, IsString, IsUrl, Max, Min } from 'class-validator';

export class CreateProjectDto {
  @IsString()
  name: string;

  @IsString()
  slug: string;

  @IsEnum(['GITHUB', 'UPLOAD'])
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

  @IsObject()
  @IsOptional()
  envVars?: Record<string, string>;

  @IsObject()
  @IsOptional()
  pipeline?: { stages: any[] };
}

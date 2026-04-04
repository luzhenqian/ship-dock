import { IsArray, IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateWebhookDto {
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  events?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  branchFilters?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  pathFilters?: string[];

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  @IsString()
  @IsOptional()
  githubToken?: string;
}

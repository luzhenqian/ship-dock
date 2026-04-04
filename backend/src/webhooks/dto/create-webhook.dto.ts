import { IsArray, IsOptional, IsString, ArrayMinSize } from 'class-validator';

export class CreateWebhookDto {
  @IsString()
  githubToken: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  events: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  branchFilters?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  pathFilters?: string[];

  @IsString()
  @IsOptional()
  secret?: string;
}

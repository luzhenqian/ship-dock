import { IsEnum, IsString, IsOptional } from 'class-validator';

export class TestConnectionDto {
  @IsEnum(['database', 'redis', 'storage'])
  type: 'database' | 'redis' | 'storage';

  @IsOptional()
  @IsString()
  host?: string;

  @IsOptional()
  @IsString()
  port?: string;

  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  password?: string;

  @IsOptional()
  @IsString()
  database?: string;

  @IsOptional()
  @IsString()
  url?: string;

  @IsOptional()
  @IsString()
  endpoint?: string;

  @IsOptional()
  @IsString()
  accessKey?: string;

  @IsOptional()
  @IsString()
  secretKey?: string;

  @IsOptional()
  @IsString()
  bucket?: string;
}

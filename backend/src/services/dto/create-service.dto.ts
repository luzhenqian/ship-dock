import { IsEnum, IsObject, IsOptional, IsString } from 'class-validator';

export class CreateServiceDto {
  @IsEnum(['POSTGRESQL', 'REDIS', 'MINIO'])
  type: 'POSTGRESQL' | 'REDIS' | 'MINIO';

  @IsString()
  name: string;

  @IsObject()
  config: Record<string, any>;
}

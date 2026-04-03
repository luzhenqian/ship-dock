import { IsObject, IsOptional, IsString } from 'class-validator';

export class UpdateServiceDto {
  @IsOptional() @IsString()
  name?: string;

  @IsOptional() @IsObject()
  config?: Record<string, any>;
}

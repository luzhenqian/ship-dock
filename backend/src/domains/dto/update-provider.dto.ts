import { IsOptional, IsString } from 'class-validator';

export class UpdateProviderDto {
  @IsString() @IsOptional()
  apiKey?: string;

  @IsString() @IsOptional()
  apiSecret?: string;
}

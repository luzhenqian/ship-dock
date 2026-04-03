import { IsEnum, IsString } from 'class-validator';

export class CreateProviderDto {
  @IsEnum(['NAMECHEAP', 'GODADDY'])
  provider: string;

  @IsString()
  apiKey: string;

  @IsString()
  apiSecret: string;
}

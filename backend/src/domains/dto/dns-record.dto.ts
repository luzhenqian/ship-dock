import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateDnsRecordDto {
  @IsString()
  name: string;

  @IsEnum(['A', 'A+DDNS', 'AAAA', 'ALIAS', 'CAA', 'CNAME', 'MX', 'NS', 'SRV', 'TXT', 'URL'])
  type: string;

  @IsString()
  value: string;

  @IsInt()
  @Min(60)
  @IsOptional()
  ttl?: number;
}

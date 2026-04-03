import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateDnsRecordDto {
  @IsString()
  name: string;

  @IsEnum(['A', 'CNAME', 'TXT', 'MX'])
  type: string;

  @IsString()
  value: string;

  @IsInt()
  @Min(60)
  @IsOptional()
  ttl?: number;
}

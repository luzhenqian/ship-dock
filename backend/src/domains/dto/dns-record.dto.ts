import { IsEnum, IsInt, IsOptional, IsString, Min, ValidateNested, IsDefined } from 'class-validator';
import { Type } from 'class-transformer';

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

export class UpdateDnsRecordDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => CreateDnsRecordDto)
  original: CreateDnsRecordDto;

  @IsDefined()
  @ValidateNested()
  @Type(() => CreateDnsRecordDto)
  updated: CreateDnsRecordDto;
}

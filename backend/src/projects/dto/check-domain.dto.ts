import { IsString } from 'class-validator';

export class CheckDomainDto {
  @IsString()
  domain: string;
}

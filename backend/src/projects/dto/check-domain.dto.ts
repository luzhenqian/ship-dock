import { IsFQDN } from 'class-validator';

export class CheckDomainDto {
  @IsFQDN()
  domain: string;
}

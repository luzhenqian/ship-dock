import { IsString, IsOptional } from 'class-validator';

export class CreatePropertyDto {
  @IsString()
  connectionId: string;

  @IsString()
  accountId: string;

  @IsString()
  displayName: string;

  @IsString()
  @IsOptional()
  timeZone?: string = 'America/New_York';

  @IsString()
  @IsOptional()
  currencyCode?: string = 'USD';
}

export class CreateDataStreamDto {
  @IsString()
  connectionId: string;

  @IsString()
  propertyId: string;

  @IsString()
  displayName: string;

  @IsString()
  defaultUri: string;
}

import { IsString } from 'class-validator';

export class CreateClarityProjectDto {
  @IsString()
  connectionId: string;

  @IsString()
  name: string;

  @IsString()
  siteUrl: string;
}

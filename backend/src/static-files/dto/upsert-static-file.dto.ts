import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class UpsertStaticFileDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  path!: string;

  @IsString()
  content!: string;
}

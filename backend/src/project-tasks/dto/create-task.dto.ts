import { IsOptional, IsString, Length, Matches } from 'class-validator';

export class CreateProjectTaskDto {
  @IsString()
  @Matches(/^[a-zA-Z0-9_-]{1,40}$/, {
    message: 'name must be 1-40 chars of letters, digits, underscore, or hyphen',
  })
  name!: string;

  @IsString()
  @Length(1, 4000)
  command!: string;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  workDir?: string;
}

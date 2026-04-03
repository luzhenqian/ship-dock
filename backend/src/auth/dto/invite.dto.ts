import { IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateInviteDto {
  @IsEmail()
  @IsOptional()
  email?: string;

  @IsEnum(['ADMIN', 'DEVELOPER', 'VIEWER'])
  role: string;
}

export class AcceptInviteDto {
  @IsString()
  token: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  @MinLength(1)
  name: string;
}

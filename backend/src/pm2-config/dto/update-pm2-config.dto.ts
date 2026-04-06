import { IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

export class UpdatePm2ConfigDto {
  @IsOptional() @IsString() @Matches(/^[a-zA-Z0-9_.\/ -]+$/, { message: 'script must be a valid file path' })
  script?: string;

  @IsOptional() @IsInt() @Min(1) @Max(16)
  instances?: number;

  @IsOptional() @IsIn(['fork', 'cluster'])
  execMode?: string;

  @IsOptional() @IsString() @Matches(/^[1-9]\d*[KMG]$/i, { message: 'maxMemoryRestart must be like "300M", "1G", or "512K"' })
  maxMemoryRestart?: string;
}

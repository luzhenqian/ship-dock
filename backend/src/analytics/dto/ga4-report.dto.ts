import { IsArray, IsInt, IsOptional, IsString } from 'class-validator';

export class RunReportDto {
  @IsArray()
  @IsString({ each: true })
  dimensions: string[];

  @IsArray()
  @IsString({ each: true })
  metrics: string[];

  @IsString()
  startDate: string;

  @IsString()
  endDate: string;

  @IsInt()
  @IsOptional()
  limit?: number;
}

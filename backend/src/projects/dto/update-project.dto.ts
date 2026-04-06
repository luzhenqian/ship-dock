import { PartialType } from '@nestjs/mapped-types';
import { ValidateIf, IsUrl, IsOptional } from 'class-validator';
import { CreateProjectDto } from './create-project.dto';

export class UpdateProjectDto extends PartialType(CreateProjectDto) {
  @ValidateIf((o) => o.repoUrl !== '')
  @IsUrl()
  @IsOptional()
  repoUrl?: string;
}

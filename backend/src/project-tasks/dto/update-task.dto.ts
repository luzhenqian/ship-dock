import { PartialType } from '@nestjs/mapped-types';
import { CreateProjectTaskDto } from './create-task.dto';

export class UpdateProjectTaskDto extends PartialType(CreateProjectTaskDto) {}

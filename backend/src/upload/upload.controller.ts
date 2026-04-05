import { BadRequestException, Controller, Param, Post, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { MinRole } from '../common/decorators/roles.decorator';
import { DeployService } from '../deploy/deploy.service';
import { execSync } from 'child_process';
import { join } from 'path';
import { mkdirSync, existsSync, writeFileSync } from 'fs';

@Controller('projects/:projectId/upload')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UploadController {
  constructor(private config: ConfigService, private deployService: DeployService) {}

  @Post() @MinRole('DEVELOPER')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 200 * 1024 * 1024 } }))
  async upload(@Param('projectId') projectId: string, @UploadedFile() file: Express.Multer.File, @Req() req: any) {
    if (!file) throw new BadRequestException('No file uploaded');

    const originalName = file.originalname.toLowerCase();
    const isZip = originalName.endsWith('.zip');
    const isTarGz = originalName.endsWith('.tar.gz') || originalName.endsWith('.tgz');
    if (!isZip && !isTarGz) {
      throw new BadRequestException('Only .zip and .tar.gz files are supported');
    }

    const projectsDir = this.config.get('PROJECTS_DIR', '/var/www');
    const ext = isZip ? '.zip' : '.tar.gz';
    const tempPath = join(projectsDir, `.upload-${projectId}${ext}`);
    writeFileSync(tempPath, file.buffer);

    const projectDir = join(projectsDir, projectId);
    if (!existsSync(projectDir)) mkdirSync(projectDir, { recursive: true });

    if (isZip) {
      execSync(`unzip -o ${tempPath} -d ${projectDir}`);
    } else {
      execSync(`tar -xzf ${tempPath} -C ${projectDir}`);
    }
    execSync(`rm ${tempPath}`);

    const deployment = await this.deployService.trigger(projectId, req.user.id, 1);
    return { message: 'Upload complete, deployment started', deployment };
  }
}

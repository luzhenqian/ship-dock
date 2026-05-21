import {
  Controller, Get, Post, Delete, Query, Body, Param, Res,
  UploadedFile, UploadedFiles, UseGuards, UseInterceptors, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { MinRole } from '../common/decorators/roles.decorator';
import { ProjectFilesService } from './project-files.service';

@Controller('projects/:projectId/files')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProjectFilesController {
  constructor(private filesService: ProjectFilesService) {}

  @Get() @MinRole('VIEWER')
  list(@Param('projectId') projectId: string, @Query('path') path: string = '') {
    return this.filesService.listDirectory(projectId, path);
  }

  @Get('stats') @MinRole('VIEWER')
  stats(@Param('projectId') projectId: string) {
    return this.filesService.getStats(projectId);
  }

  @Get('directories') @MinRole('VIEWER')
  directories(@Param('projectId') projectId: string) {
    return this.filesService.listDirectories(projectId);
  }

  @Get('download') @MinRole('VIEWER')
  async download(
    @Param('projectId') projectId: string,
    @Query('path') path: string,
    @Res() res: Response,
  ) {
    if (!path) throw new BadRequestException('path query parameter is required');
    const { stream, filename, size } = await this.filesService.downloadFile(projectId, path);
    res.set({
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      'Content-Length': size.toString(),
    });
    stream.pipe(res);
  }

  @Post('upload') @MinRole('DEVELOPER')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 500 * 1024 * 1024 } }))
  upload(
    @Param('projectId') projectId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('targetDir') targetDir: string = '',
    @Body('extract') extract: string = 'false',
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.filesService.uploadFile(projectId, file, targetDir, extract === 'true');
  }

  @Post('upload-batch') @MinRole('DEVELOPER')
  @UseInterceptors(FilesInterceptor('files', 2000, { limits: { fileSize: 500 * 1024 * 1024 } }))
  uploadBatch(
    @Param('projectId') projectId: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Body('targetDir') targetDir: string = '',
    @Body('paths') paths: string | string[] = [],
  ) {
    if (!files || files.length === 0) throw new BadRequestException('No files uploaded');
    const pathsArr = Array.isArray(paths) ? paths : [paths];
    return this.filesService.uploadBatch(projectId, files, targetDir, pathsArr);
  }

  @Post('mkdir') @MinRole('DEVELOPER')
  mkdir(@Param('projectId') projectId: string, @Body('path') path: string) {
    if (!path) throw new BadRequestException('path is required');
    return this.filesService.createDirectory(projectId, path);
  }

  @Post('extract') @MinRole('DEVELOPER')
  extract(@Param('projectId') projectId: string, @Body('path') path: string) {
    if (!path) throw new BadRequestException('path is required');
    return this.filesService.extract(projectId, path);
  }

  @Delete() @MinRole('DEVELOPER')
  delete(@Param('projectId') projectId: string, @Query('path') path: string) {
    if (!path) throw new BadRequestException('path query parameter is required');
    return this.filesService.deleteFile(projectId, path);
  }
}

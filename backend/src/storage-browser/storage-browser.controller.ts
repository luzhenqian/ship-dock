import { Controller, Delete, Get, Param, Post, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { MinRole } from '../common/decorators/roles.decorator';
import { StorageBrowserService } from './storage-browser.service';

@Controller('projects/:projectId/storage')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StorageBrowserController {
  constructor(private storageService: StorageBrowserService) {}

  @Get('buckets') @MinRole('VIEWER')
  listBuckets(@Param('projectId') projectId: string) {
    return this.storageService.listBuckets(projectId);
  }

  @Get('buckets/:bucket') @MinRole('VIEWER')
  listObjects(
    @Param('projectId') projectId: string,
    @Param('bucket') bucket: string,
    @Query('prefix') prefix?: string,
    @Query('delimiter') delimiter?: string,
    @Query('maxKeys') maxKeys?: string,
  ) {
    return this.storageService.listObjects(projectId, bucket, {
      prefix,
      delimiter,
      maxKeys: maxKeys ? parseInt(maxKeys) : undefined,
    });
  }

  @Get('buckets/:bucket/download') @MinRole('VIEWER')
  async downloadObject(
    @Param('projectId') projectId: string,
    @Param('bucket') bucket: string,
    @Query('key') key: string,
    @Res() res: Response,
  ) {
    const stat = await this.storageService.getObjectStat(projectId, bucket, key);
    const stream = await this.storageService.getObject(projectId, bucket, key);

    const filename = key.split('/').pop() || 'download';
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', stat.metaData?.['content-type'] || 'application/octet-stream');
    if (stat.size) res.setHeader('Content-Length', stat.size.toString());

    stream.pipe(res);
  }

  @Post('buckets/:bucket/upload') @MinRole('DEVELOPER')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }))
  async uploadObject(
    @Param('projectId') projectId: string,
    @Param('bucket') bucket: string,
    @Query('prefix') prefix: string = '',
    @UploadedFile() file: Express.Multer.File,
  ) {
    const key = prefix ? `${prefix}${file.originalname}` : file.originalname;
    return this.storageService.uploadObject(projectId, bucket, key, file.buffer, file.mimetype);
  }

  @Delete('buckets/:bucket/objects') @MinRole('DEVELOPER')
  deleteObject(
    @Param('projectId') projectId: string,
    @Param('bucket') bucket: string,
    @Query('key') key: string,
  ) {
    return this.storageService.deleteObject(projectId, bucket, key);
  }
}

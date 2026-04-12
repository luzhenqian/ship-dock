import {
  Controller, Get, Post, Param, Body, UseGuards, UseInterceptors, UploadedFiles, BadRequestException,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { MinRole } from '../common/decorators/roles.decorator';
import { StorageImportService } from './storage-import.service';
import {
  TestStorageConnectionDto, DiscoverStorageObjectsDto, ValidateUrlsDto, CreateStorageImportDto,
} from './dto/create-storage-import.dto';
import { ConfigService } from '@nestjs/config';
import { mkdirSync, existsSync, renameSync, statSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';

const MAX_FILE_SIZE = 1024 * 1024 * 1024;

@Controller('projects/:projectId/storage/import')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StorageImportController {
  constructor(
    private importService: StorageImportService,
    private config: ConfigService,
  ) {}

  @Post('test-connection') @MinRole('DEVELOPER')
  testConnection(@Body() dto: TestStorageConnectionDto) {
    return this.importService.testConnection(dto.connection);
  }

  @Post('discover') @MinRole('DEVELOPER')
  discover(@Body() dto: DiscoverStorageObjectsDto) {
    return this.importService.discoverObjects({ ...dto.connection, bucket: dto.bucket, prefix: dto.prefix });
  }

  @Post('validate-urls') @MinRole('DEVELOPER')
  validateUrls(@Body() dto: ValidateUrlsDto) {
    return this.importService.validateUrls(dto);
  }

  @Post('upload') @MinRole('DEVELOPER')
  @UseInterceptors(FilesInterceptor('files', 50, {
    limits: { fileSize: MAX_FILE_SIZE },
    storage: diskStorage({
      destination: (_req, _file, cb) => {
        const tempDir = process.env.TEMP_DIR || '/tmp';
        if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true });
        cb(null, tempDir);
      },
      filename: (_req, file, cb) => {
        const hex = randomBytes(8).toString('hex');
        const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
        cb(null, `storage-import-${hex}-${safeName}`);
      },
    }),
  }))
  upload(@UploadedFiles() files: Express.Multer.File[]) {
    if (!files?.length) throw new BadRequestException('No files uploaded');

    const results = files.map((file) => ({
      fileKey: file.filename,
      fileName: file.originalname,
      fileSize: file.size,
    }));

    return { files: results };
  }

  @Post() @MinRole('DEVELOPER')
  create(@Param('projectId') projectId: string, @Body() dto: CreateStorageImportDto) {
    return this.importService.createImport(projectId, dto);
  }

  @Get(':importId') @MinRole('VIEWER')
  getOne(@Param('importId') importId: string) {
    return this.importService.getImport(importId);
  }

  @Post(':importId/cancel') @MinRole('DEVELOPER')
  cancel(@Param('importId') importId: string) {
    return this.importService.cancelImport(importId);
  }
}

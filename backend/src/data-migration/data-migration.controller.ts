import {
  Controller, Get, Post, Param, Body, Req, UseGuards, UseInterceptors, UploadedFile, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { MinRole } from '../common/decorators/roles.decorator';
import { DataMigrationService } from './data-migration.service';
import { CreateMigrationDto, TestConnectionDto, DiscoverTablesDto, AnalyzeFileDto } from './dto/create-migration.dto';
import { ConfigService } from '@nestjs/config';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';

const MAX_FILE_SIZE = 1024 * 1024 * 1024; // 1GB

@Controller('projects/:projectId/migrations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DataMigrationController {
  constructor(
    private migrationService: DataMigrationService,
    private config: ConfigService,
  ) {}

  @Post('test-connection') @MinRole('DEVELOPER')
  testConnection(@Body() dto: TestConnectionDto) {
    return this.migrationService.testConnection(dto.connection);
  }

  @Post('discover-tables') @MinRole('DEVELOPER')
  discoverTables(@Body() dto: DiscoverTablesDto) {
    return this.migrationService.discoverTables(dto.connection);
  }

  @Post('upload') @MinRole('DEVELOPER')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }))
  upload(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');

    const ext = file.originalname.split('.').pop()?.toLowerCase();
    if (!['sql', 'dump'].includes(ext || '')) {
      throw new BadRequestException('Only .sql and .dump files are supported');
    }

    const tempDir = this.config.get('TEMP_DIR', '/tmp');
    if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true });

    const fileKey = `migration-${randomBytes(8).toString('hex')}.${ext}`;
    const filePath = join(tempDir, fileKey);
    writeFileSync(filePath, file.buffer);

    return { fileKey, fileName: file.originalname, fileSize: file.size };
  }

  @Post('analyze-file') @MinRole('DEVELOPER')
  analyzeFile(@Body() dto: AnalyzeFileDto) {
    return this.migrationService.analyzeFile(dto);
  }

  @Post() @MinRole('DEVELOPER')
  create(
    @Param('projectId') projectId: string,
    @Body() dto: CreateMigrationDto,
    @Req() req: any,
  ) {
    return this.migrationService.createMigration(projectId, req.user.id, dto);
  }

  @Get() @MinRole('VIEWER')
  list(@Param('projectId') projectId: string) {
    return this.migrationService.getMigrations(projectId);
  }

  @Get(':migrationId') @MinRole('VIEWER')
  getOne(@Param('migrationId') migrationId: string) {
    return this.migrationService.getMigration(migrationId);
  }

  @Post(':migrationId/cancel') @MinRole('DEVELOPER')
  cancel(@Param('migrationId') migrationId: string) {
    return this.migrationService.cancelMigration(migrationId);
  }
}

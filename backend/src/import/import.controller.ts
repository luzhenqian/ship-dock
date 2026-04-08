import {
  Controller, Get, Post, Patch, Delete, Param, Body, Req,
  UseGuards, UseInterceptors, UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { MinRole } from '../common/decorators/roles.decorator';
import { ImportService } from './import.service';
import { CreateImportDto } from './dto/create-import.dto';
import { SubmitImportConfigDto } from './dto/import-config.dto';
import { TestConnectionDto } from './dto/test-connection.dto';

const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2GB

@Controller('imports')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ImportController {
  constructor(private importService: ImportService) {}

  @Post('token')
  @MinRole('ADMIN')
  createUploadToken() {
    return this.importService.createUploadToken();
  }

  @Post('upload')
  @MinRole('ADMIN')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }))
  upload(@UploadedFile() file: Express.Multer.File, @Body('importId') importId: string, @Req() req: any) {
    return this.importService.handleUpload(file, req.user.id, importId);
  }

  @Get('upload/:id')
  @MinRole('ADMIN')
  getUpload(@Param('id') id: string) {
    return this.importService.getUpload(id);
  }

  @Post()
  @MinRole('ADMIN')
  create(@Body() dto: CreateImportDto, @Req() req: any) {
    return this.importService.createImport(req.user.id, dto);
  }

  @Get(':id')
  @MinRole('ADMIN')
  getOne(@Param('id') id: string) {
    return this.importService.getImport(id);
  }

  @Patch(':id/config')
  @MinRole('ADMIN')
  updateConfig(@Param('id') id: string, @Body() dto: SubmitImportConfigDto) {
    return this.importService.updateConfig(id, dto);
  }

  @Post(':id/start')
  @MinRole('ADMIN')
  start(@Param('id') id: string) {
    return this.importService.startImport(id);
  }

  @Post(':id/cancel')
  @MinRole('ADMIN')
  cancel(@Param('id') id: string) {
    return this.importService.cancelImport(id);
  }

  @Delete(':id')
  @MinRole('ADMIN')
  remove(@Param('id') id: string) {
    return this.importService.deleteImport(id);
  }

  @Post(':id/progress')
  @MinRole('ADMIN')
  reportProgress(@Param('id') id: string, @Body() body: { stage: string; message?: string; percent?: number }) {
    return this.importService.reportProgress(id, body);
  }

  @Post('test-connection')
  @MinRole('ADMIN')
  testConnection(@Body() dto: TestConnectionDto) {
    return this.importService.testConnection(dto);
  }
}

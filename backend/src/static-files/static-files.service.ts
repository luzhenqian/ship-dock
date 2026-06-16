import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class StaticFilesService {
  constructor(private prisma: PrismaService) {}

  validatePath(path: string): void {
    if (!path || path.trim() === '') throw new BadRequestException('File path cannot be empty');
    if (path.startsWith('/')) throw new BadRequestException('Path must be relative');
    if (path.includes('..')) throw new BadRequestException('Path traversal not allowed');
    if (/[;&|`$]/.test(path)) throw new BadRequestException('Invalid characters in path');
  }

  async list(projectId: string) {
    return this.prisma.staticFile.findMany({ where: { projectId }, orderBy: { path: 'asc' } });
  }

  async upsert(projectId: string, path: string, content: string) {
    this.validatePath(path);
    if (Buffer.byteLength(content, 'utf8') > 1024 * 1024) {
      throw new BadRequestException('File content exceeds 1 MB limit');
    }
    return this.prisma.staticFile.upsert({
      where: { projectId_path: { projectId, path } },
      create: { projectId, path, content },
      update: { content },
    });
  }

  async remove(projectId: string, path: string) {
    this.validatePath(path);
    return this.prisma.staticFile.delete({
      where: { projectId_path: { projectId, path } },
    });
  }

  async clearAll(projectId: string) {
    return this.prisma.staticFile.deleteMany({ where: { projectId } });
  }

  async seed(projectId: string) {
    const defaultHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>My Site</title>
</head>
<body>
  <h1>Hello, world!</h1>
</body>
</html>`;
    return this.upsert(projectId, 'index.html', defaultHtml);
  }
}

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/prisma.service';
import { join, resolve, basename, dirname } from 'path';
import {
  readdirSync, statSync, existsSync, mkdirSync, writeFileSync, unlinkSync, createReadStream,
} from 'fs';
import { rmSync } from 'fs';
import { execSync } from 'child_process';

@Injectable()
export class ProjectFilesService {
  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
  ) {}

  private async getProjectDir(projectId: string): Promise<string> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');
    const projectsDir = this.config.get('PROJECTS_DIR', '/var/www');
    return join(projectsDir, project.directory || project.slug);
  }

  private validatePath(projectDir: string, userPath: string): string {
    if (/[;|$`]/.test(userPath)) {
      throw new BadRequestException('Path contains invalid characters');
    }
    if (userPath.includes('..')) {
      throw new BadRequestException('Path traversal is not allowed');
    }
    const resolved = resolve(projectDir, userPath);
    if (!resolved.startsWith(projectDir)) {
      throw new BadRequestException('Path is outside project directory');
    }
    const relative = resolved.slice(projectDir.length + 1);
    const parts = relative.split('/');
    if (parts.includes('.git') || parts.includes('node_modules')) {
      throw new BadRequestException('Access to .git and node_modules is not allowed');
    }
    return resolved;
  }

  async listDirectory(projectId: string, path: string) {
    const projectDir = await this.getProjectDir(projectId);
    const targetDir = path ? this.validatePath(projectDir, path) : projectDir;

    if (!existsSync(targetDir)) {
      return { path, items: [] };
    }

    const entries = readdirSync(targetDir, { withFileTypes: true });
    const items = entries
      .filter((e) => e.name !== '.git' && e.name !== 'node_modules')
      .map((entry) => {
        const fullPath = join(targetDir, entry.name);
        const stat = statSync(fullPath);
        return {
          name: entry.name,
          type: entry.isDirectory() ? 'directory' as const : 'file' as const,
          size: entry.isDirectory() ? 0 : stat.size,
          modifiedAt: stat.mtime.toISOString(),
        };
      })
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    return { path, items };
  }

  async getStats(projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');
    const projectDir = await this.getProjectDir(projectId);
    const used = this.calculateDirSize(projectDir);
    return {
      used,
      fileSizeLimit: project.fileSizeLimit,
      fileTotalLimit: Number(project.fileTotalLimit),
    };
  }

  private calculateDirSize(dir: string): number {
    if (!existsSync(dir)) return 0;
    try {
      const output = execSync(
        `du -sb --exclude='.git' --exclude='node_modules' "${dir}" 2>/dev/null || echo "0\t${dir}"`,
        { encoding: 'utf-8' },
      );
      return parseInt(output.split('\t')[0], 10) || 0;
    } catch {
      return 0;
    }
  }

  async uploadFile(
    projectId: string,
    file: Express.Multer.File,
    targetDir: string,
    extract: boolean,
  ) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');

    if (file.size > project.fileSizeLimit) {
      throw new BadRequestException(
        `File size ${this.formatBytes(file.size)} exceeds limit of ${this.formatBytes(project.fileSizeLimit)}`,
      );
    }

    const projectDir = await this.getProjectDir(projectId);
    const destDir = targetDir ? this.validatePath(projectDir, targetDir) : projectDir;

    const currentUsage = this.calculateDirSize(projectDir);
    const totalLimit = Number(project.fileTotalLimit);
    if (currentUsage + file.size > totalLimit) {
      throw new BadRequestException(
        `Upload would exceed total storage limit of ${this.formatBytes(totalLimit)}. Currently using ${this.formatBytes(currentUsage)}.`,
      );
    }

    if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
    const filePath = join(destDir, file.originalname);
    writeFileSync(filePath, file.buffer);

    if (extract && this.isArchive(file.originalname)) {
      await this.extractArchive(projectId, projectDir, filePath, totalLimit, currentUsage + file.size);
      unlinkSync(filePath);
      return { message: 'File uploaded and extracted', extracted: true };
    }

    return { message: 'File uploaded', extracted: false };
  }

  async uploadBatch(
    projectId: string,
    files: Express.Multer.File[],
    targetDir: string,
    relativePaths: string[],
  ) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');

    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    const projectDir = await this.getProjectDir(projectId);
    const currentUsage = this.calculateDirSize(projectDir);
    const totalLimit = Number(project.fileTotalLimit);

    if (currentUsage + totalSize > totalLimit) {
      throw new BadRequestException(
        `Upload would exceed total storage limit of ${this.formatBytes(totalLimit)}. Currently using ${this.formatBytes(currentUsage)}, upload is ${this.formatBytes(totalSize)}.`,
      );
    }

    const baseDir = targetDir ? this.validatePath(projectDir, targetDir) : projectDir;
    let uploaded = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const relativePath = relativePaths[i] || file.originalname;

      if (file.size > project.fileSizeLimit) continue;

      const fileDest = join(baseDir, relativePath);
      const resolvedDest = resolve(fileDest);
      if (!resolvedDest.startsWith(projectDir)) continue;

      const destDir = dirname(resolvedDest);
      if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
      writeFileSync(resolvedDest, file.buffer);
      uploaded++;
    }

    return { message: `Uploaded ${uploaded} files`, count: uploaded };
  }

  async createDirectory(projectId: string, path: string) {
    const projectDir = await this.getProjectDir(projectId);
    const targetDir = this.validatePath(projectDir, path);
    if (existsSync(targetDir)) {
      throw new BadRequestException('Directory already exists');
    }
    mkdirSync(targetDir, { recursive: true });
    return { message: 'Directory created' };
  }

  async downloadFile(projectId: string, path: string) {
    const projectDir = await this.getProjectDir(projectId);
    const filePath = this.validatePath(projectDir, path);
    if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
      throw new NotFoundException('File not found');
    }
    const stat = statSync(filePath);
    const stream = createReadStream(filePath);
    const filename = basename(filePath);
    return { stream, filename, size: stat.size };
  }

  async deleteFile(projectId: string, path: string) {
    if (!path) throw new BadRequestException('Path is required');
    const projectDir = await this.getProjectDir(projectId);
    const filePath = this.validatePath(projectDir, path);
    if (!existsSync(filePath)) throw new NotFoundException('File not found');

    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      rmSync(filePath, { recursive: true, force: true });
    } else {
      unlinkSync(filePath);
    }
    return { message: 'Deleted successfully' };
  }

  async extract(projectId: string, path: string) {
    if (!path) throw new BadRequestException('Path is required');
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');

    const projectDir = await this.getProjectDir(projectId);
    const filePath = this.validatePath(projectDir, path);
    if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
      throw new NotFoundException('Archive file not found');
    }
    if (!this.isArchive(filePath)) {
      throw new BadRequestException('File is not a supported archive format (.zip, .tar.gz, .tgz)');
    }

    const totalLimit = Number(project.fileTotalLimit);
    const currentUsage = this.calculateDirSize(projectDir);
    await this.extractArchive(projectId, projectDir, filePath, totalLimit, currentUsage);

    return { message: 'Archive extracted' };
  }

  private async extractArchive(
    projectId: string,
    projectDir: string,
    filePath: string,
    totalLimit: number,
    currentUsage: number,
  ) {
    const uncompressedSize = this.getArchiveSize(filePath);
    if (currentUsage + uncompressedSize > totalLimit) {
      throw new BadRequestException(
        `Extraction would exceed total storage limit of ${this.formatBytes(totalLimit)}. ` +
        `Currently using ${this.formatBytes(currentUsage)}, archive contains ${this.formatBytes(uncompressedSize)}.`,
      );
    }

    const targetDir = dirname(filePath);
    const lower = filePath.toLowerCase();
    if (lower.endsWith('.zip')) {
      execSync(`unzip -o "${filePath}" -d "${targetDir}"`, { timeout: 60000 });
    } else {
      execSync(`tar -xzf "${filePath}" -C "${targetDir}"`, { timeout: 60000 });
    }
  }

  private getArchiveSize(filePath: string): number {
    try {
      const lower = filePath.toLowerCase();
      if (lower.endsWith('.zip')) {
        const output = execSync(`unzip -l "${filePath}" | tail -1`, { encoding: 'utf-8' });
        const match = output.match(/^\s*(\d+)/);
        return match ? parseInt(match[1], 10) : 0;
      } else {
        const listed = execSync(
          `tar -tvf "${filePath}" 2>/dev/null | awk '{s+=$3} END {print s+0}'`,
          { encoding: 'utf-8' },
        );
        return parseInt(listed.trim(), 10) || 0;
      }
    } catch {
      return 0;
    }
  }

  private isArchive(filename: string): boolean {
    const lower = filename.toLowerCase();
    return lower.endsWith('.zip') || lower.endsWith('.tar.gz') || lower.endsWith('.tgz');
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
    return `${(bytes / 1073741824).toFixed(1)} GB`;
  }

  async listDirectories(projectId: string): Promise<string[]> {
    const projectDir = await this.getProjectDir(projectId);
    if (!existsSync(projectDir)) return [];
    const dirs: string[] = [];
    const walk = (dir: string, prefix: string) => {
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          if (entry.name === '.git' || entry.name === 'node_modules') continue;
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
          dirs.push(rel);
          walk(join(dir, entry.name), rel);
        }
      } catch {}
    };
    walk(projectDir, '');
    return dirs;
  }
}

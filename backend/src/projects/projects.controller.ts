import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { MinRole } from '../common/decorators/roles.decorator';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

@Controller('projects')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProjectsController {
  constructor(private projectsService: ProjectsService) {}

  @Get('github/branches')
  @MinRole('VIEWER')
  async getGithubBranches(@Query('repoUrl') repoUrl: string) {
    if (!repoUrl) throw new BadRequestException('repoUrl is required');
    // Extract owner/repo from GitHub URL
    const match = repoUrl.replace(/\.git$/, '').match(/github\.com\/([^/]+)\/([^/]+)/);
    if (!match) throw new BadRequestException('Invalid GitHub URL');
    const [, owner, repo] = match;

    try {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/branches?per_page=100`, {
        headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'ShipDock' },
      });
      if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);
      const branches = await res.json() as Array<{ name: string }>;
      // Find default branch
      const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
        headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'ShipDock' },
      });
      let defaultBranch = 'main';
      if (repoRes.ok) {
        const repoData = await repoRes.json() as { default_branch: string };
        defaultBranch = repoData.default_branch;
      }
      return { branches: branches.map((b) => b.name), defaultBranch };
    } catch (err: any) {
      throw new BadRequestException(`Failed to fetch branches: ${err.message}`);
    }
  }

  @Get('settings/projects-dir')
  @MinRole('VIEWER')
  getProjectsDir() {
    return { projectsDir: this.projectsService.getProjectsDir() };
  }

  @Post() @MinRole('ADMIN')
  create(@Req() req: any, @Body() dto: CreateProjectDto) { return this.projectsService.create(req.user.id, dto); }

  @Get() @MinRole('VIEWER')
  findAll() { return this.projectsService.findAll(); }

  @Get(':id') @MinRole('VIEWER')
  findOne(@Param('id') id: string) { return this.projectsService.findOne(id); }

  @Get(':id/env')
  @MinRole('DEVELOPER')
  getEnvVars(@Param('id') id: string) { return this.projectsService.getDecryptedEnvVars(id); }

  @Patch(':id') @MinRole('ADMIN')
  update(@Param('id') id: string, @Body() dto: UpdateProjectDto) { return this.projectsService.update(id, dto); }

  @Delete(':id') @MinRole('ADMIN')
  delete(@Param('id') id: string) { return this.projectsService.delete(id); }

  @Patch(':id/pipeline') @MinRole('DEVELOPER')
  updatePipeline(@Param('id') id: string, @Body() pipeline: any) { return this.projectsService.update(id, { pipeline }); }

  @Post(':id/stop') @MinRole('DEVELOPER')
  stop(@Param('id') id: string) { return this.projectsService.stop(id); }

  @Post(':id/restart') @MinRole('DEVELOPER')
  restart(@Param('id') id: string) { return this.projectsService.restart(id); }
}

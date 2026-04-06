import { Controller, Delete, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { MinRole } from '../common/decorators/roles.decorator';
import { GitHubAppService } from './github-app.service';

@Controller('github')
@UseGuards(JwtAuthGuard, RolesGuard)
export class GitHubAppController {
  constructor(private githubApp: GitHubAppService) {}

  @Get('installation-url')
  getInstallationUrl() {
    return { url: this.githubApp.getInstallationUrl() };
  }

  @Get('callback')
  async handleCallback(
    @Query('installation_id') installationIdStr: string,
    @Query('setup_action') setupAction: string,
    @Req() req: any,
  ) {
    if (setupAction !== 'install' && setupAction !== 'update') {
      return { success: false, message: 'Unsupported setup action' };
    }

    const installationId = parseInt(installationIdStr, 10);
    if (isNaN(installationId)) {
      return { success: false, message: 'Invalid installation_id' };
    }

    const appJwt = this.githubApp.generateAppJwt();
    const res = await fetch(`https://api.github.com/app/installations/${installationId}`, {
      headers: {
        Authorization: `Bearer ${appJwt}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (!res.ok) {
      return { success: false, message: 'Installation not found on GitHub' };
    }

    const installationData = await res.json();
    const installation = await this.githubApp.saveInstallation(
      req.user.id,
      installationId,
      installationData.account.login,
      installationData.account.type,
    );

    return { success: true, installation };
  }

  @Get('installations')
  async listInstallations(@Req() req: any) {
    return this.githubApp.getUserInstallations(req.user.id);
  }

  @Get('repositories')
  @MinRole('DEVELOPER')
  async listRepositories(@Query('installationId') installationId: string) {
    return this.githubApp.listRepositories(parseInt(installationId, 10));
  }

  @Delete('installations/:id')
  @MinRole('ADMIN')
  async deleteInstallation(@Param('id') id: string, @Req() req: any) {
    await this.githubApp.deleteInstallation(id, req.user.id);
    return { success: true };
  }
}

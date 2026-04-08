#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { scanServer } from './scanner';
import { DetectedProject } from './detectors';
import { packageProjects } from './packager';
import { uploadPackage } from './uploader';

const program = new Command();

program
  .name('ship-dock-migrate')
  .description('Scan this server for running projects and migrate them to Ship Dock')
  .version('0.1.0')
  .option('-s, --server <url>', 'Ship Dock server URL')
  .option('-t, --token <token>', 'Ship Dock API token')
  .option('--scan-only', 'Only scan and display projects, do not package or upload')
  .option('--import-id <id>', 'Import ID for progress reporting')
  .action(async (options: { server?: string; token?: string; scanOnly?: boolean; importId?: string }) => {
    console.log('');
    console.log(chalk.bold('  Ship Dock Migration CLI'));
    console.log(chalk.gray('  Scan, collect, and upload projects to Ship Dock'));
    console.log('');

    // Step 1: Get server URL and token
    let serverUrl = options.server;
    let token = options.token;

    if (!options.scanOnly) {
      if (!serverUrl) {
        const { url } = await inquirer.prompt<{ url: string }>([
          {
            type: 'input',
            name: 'url',
            message: 'Ship Dock server URL:',
            validate: (input: string) => {
              try {
                new URL(input);
                return true;
              } catch {
                return 'Please enter a valid URL (e.g., https://shipdock.example.com)';
              }
            },
          },
        ]);
        serverUrl = url;
      }

      if (!token) {
        const { apiToken } = await inquirer.prompt<{ apiToken: string }>([
          {
            type: 'password',
            name: 'apiToken',
            message: 'Ship Dock API token:',
            mask: '*',
            validate: (input: string) =>
              input.length > 0 || 'API token is required.',
          },
        ]);
        token = apiToken;
      }

      // Step 2: Verify token before doing any work
      const verifySpinner = ora('Verifying connection to Ship Dock...').start();
      try {
        const verifyUrl = `${serverUrl.replace(/\/+$/, '')}/imports/token`;
        const res = await fetch(verifyUrl, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        });
        if (res.status === 401 || res.status === 403) {
          verifySpinner.fail('Authentication failed — token is invalid or expired');
          console.log(chalk.gray('\n  Get a new token from the Ship Dock import page.\n'));
          process.exit(1);
        }
        if (!res.ok && res.status !== 404) {
          verifySpinner.fail(`Server returned ${res.status}`);
          process.exit(1);
        }
        verifySpinner.succeed('Connected to Ship Dock');
      } catch (err: any) {
        verifySpinner.fail(`Cannot reach Ship Dock server: ${err.message}`);
        process.exit(1);
      }
    }

    // Helper: report progress to Ship Dock server
    const reportProgress = async (stage: string, message?: string, percent?: number) => {
      if (!options.importId || !serverUrl || !token) return;
      try {
        const url = `${serverUrl.replace(/\/+$/, '')}/imports/${options.importId}/progress`;
        await fetch(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ stage, message, percent }),
        });
      } catch { /* ignore progress reporting errors */ }
    };

    // Step 3: Scan
    await reportProgress('scanning', 'Scanning server for running projects...');
    const spinner = ora('Scanning server for running projects...').start();
    let projects: DetectedProject[];
    try {
      projects = await scanServer();
      spinner.succeed(`Found ${projects.length} project(s)`);
    } catch (err) {
      spinner.fail('Failed to scan server');
      console.error(chalk.red(String(err)));
      process.exit(1);
    }

    if (projects.length === 0) {
      console.log(chalk.yellow('\n  No projects detected on this server.'));
      console.log(chalk.gray('  Make sure projects are running via PM2, Docker, systemd, or as processes.\n'));
      process.exit(0);
    }

    // Step 4: Display projects
    console.log('');
    for (const p of projects) {
      const detectors = chalk.gray(`[${p.detectedBy}]`);
      const port = p.port ? chalk.cyan(`:${p.port}`) : '';
      const runtime = p.runtime ? chalk.blue(p.runtime) : '';
      const domain = p.nginx?.serverName ? chalk.green(p.nginx.serverName) : '';
      const db = p.databaseUrl ? chalk.yellow('DB') : '';
      const redis = p.redisUrl ? chalk.magenta('Redis') : '';
      const git = p.gitRemote ? chalk.gray('git') : chalk.gray('no-git');

      console.log(`  ${chalk.bold(p.name)} ${detectors}`);
      console.log(`    ${p.directory}`);
      console.log(`    ${[runtime, port, domain, db, redis, git].filter(Boolean).join(' | ')}`);
      console.log('');
    }

    if (options.scanOnly) {
      process.exit(0);
    }

    // Step 5: Select projects
    const { selectedProjects } = await inquirer.prompt<{
      selectedProjects: DetectedProject[];
    }>([
      {
        type: 'checkbox',
        name: 'selectedProjects',
        message: 'Select projects to migrate:',
        choices: projects.map((p) => ({
          name: `${p.name} (${p.directory})`,
          value: p,
          checked: true,
        })),
        validate: (answer: DetectedProject[]) =>
          answer.length > 0 || 'Select at least one project.',
      },
    ]);

    // Step 6: Collect and package
    console.log('');
    await reportProgress('packaging', `Packaging ${selectedProjects.length} project(s)...`);
    const packageSpinner = ora('Packaging projects...').start();

    let packageResult;
    try {
      packageResult = await packageProjects(selectedProjects, async (progress) => {
        packageSpinner.text = `[${progress.current}/${progress.total}] ${progress.project}: ${progress.step}`;
        await reportProgress('packaging', `[${progress.current}/${progress.total}] ${progress.project}: ${progress.step}`, Math.round((progress.current / progress.total) * 100));
      });
      packageSpinner.succeed(
        `Package created (${formatBytes(packageResult.sizeBytes)}, ${packageResult.projectCount} projects)`,
      );
    } catch (err) {
      packageSpinner.fail('Failed to create migration package');
      console.error(chalk.red(String(err)));
      process.exit(1);
    }

    // Step 7: Upload
    await reportProgress('uploading', 'Starting upload...', 0);
    const uploadSpinner = ora('Uploading to Ship Dock...').start();

    try {
      const result = await uploadPackage(
        packageResult.packagePath,
        serverUrl!,
        token!,
        async (progress) => {
          uploadSpinner.text = `Uploading... ${progress.percent}%`;
          if (progress.percent % 10 === 0) {
            await reportProgress('uploading', `Uploading... ${progress.percent}%`, progress.percent);
          }
        },
        options.importId,
      );

      if (result.success) {
        await reportProgress('done', 'Upload complete!', 100);
        uploadSpinner.succeed('Upload complete!');
        console.log('');
        if (result.importId) {
          console.log(chalk.green(`  Import ID: ${result.importId}`));
          console.log(
            chalk.gray(`  View at: ${serverUrl}/imports/${result.importId}`),
          );
        }
        console.log(
          chalk.green('\n  Migration package uploaded successfully!'),
        );
        console.log(
          chalk.gray('  Go to Ship Dock to review and complete the import.\n'),
        );
      } else {
        uploadSpinner.fail('Upload failed');
        console.error(chalk.red(`  ${result.error}\n`));
        console.log(
          chalk.gray(
            `  Package saved at: ${packageResult.packagePath}`,
          ),
        );
        console.log(
          chalk.gray('  You can manually upload it via the Ship Dock UI.\n'),
        );
        process.exit(1);
      }
    } catch (err) {
      uploadSpinner.fail('Upload failed');
      console.error(chalk.red(String(err)));
      console.log(
        chalk.gray(`\n  Package saved at: ${packageResult.packagePath}`),
      );
      console.log(
        chalk.gray('  You can manually upload it via the Ship Dock UI.\n'),
      );
      process.exit(1);
    }
  });

program.parse();

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

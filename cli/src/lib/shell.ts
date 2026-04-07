import { execFile, exec } from 'child_process';

interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function run(command: string, args: string[] = []): Promise<ShellResult> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 300_000 }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout?.toString().trim() ?? '',
        stderr: stderr?.toString().trim() ?? '',
        exitCode: error?.code ?? (error ? 1 : 0),
      });
    });
  });
}

export function runShell(command: string): Promise<ShellResult> {
  return new Promise((resolve) => {
    exec(command, { timeout: 300_000 }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout?.toString().trim() ?? '',
        stderr: stderr?.toString().trim() ?? '',
        exitCode: error?.code ?? (error ? 1 : 0),
      });
    });
  });
}

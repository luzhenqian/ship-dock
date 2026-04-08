import { runShell } from './shell.js';

const PROJECT_DIR = '/opt/shipdock';

/**
 * Create or update admin account.
 * Tries the API setup endpoint first. If already set up, updates directly via a helper script.
 */
/**
 * Create or update admin account.
 * Returns the access token (from setup or login) for subsequent API calls.
 */
export async function ensureAdmin(email: string, password: string, port: string): Promise<string> {
  // Wait for API to be ready
  let ready = false;
  for (let i = 0; i < 15; i++) {
    const health = await runShell(`curl -sf http://localhost:${port}/api/health`);
    if (health.exitCode === 0) { ready = true; break; }
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (!ready) throw new Error('API failed to start — check: pm2 logs ship-dock-api');

  // Try setup endpoint
  const payload = JSON.stringify({ email, password, name: 'Admin' });
  const result = await runShell(`curl -s -X POST http://localhost:${port}/api/auth/setup -H "Content-Type: application/json" -d '${payload}'`);

  if (result.stdout.includes('Setup already completed')) {
    // Write a temp script to update password — avoids shell escaping issues with bcrypt $
    const scriptContent = `
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');
async function main() {
  const hash = await bcrypt.hash(process.argv[2], 10);
  const prisma = new PrismaClient();
  await prisma.user.updateMany({ where: { role: 'OWNER' }, data: { email: process.argv[3], password: hash } });
  await prisma.$disconnect();
  console.log('OK');
}
main().catch(e => { console.error(e.message); process.exit(1); });
`;
    const { writeFileSync, unlinkSync } = await import('fs');
    const scriptPath = `${PROJECT_DIR}/backend/_update-admin.cjs`;
    writeFileSync(scriptPath, scriptContent);
    const update = await runShell(`cd ${PROJECT_DIR}/backend && node _update-admin.cjs '${password}' '${email}'`);
    unlinkSync(scriptPath);
    if (update.exitCode !== 0) throw new Error(update.stderr || 'Failed to update admin');

    // Login to get token
    const loginPayload = JSON.stringify({ email, password });
    const loginResult = await runShell(`curl -s -X POST http://localhost:${port}/api/auth/login -H "Content-Type: application/json" -d '${loginPayload}'`);
    try {
      const loginData = JSON.parse(loginResult.stdout);
      return loginData.accessToken || '';
    } catch {
      return '';
    }
  } else if (result.stdout.includes('error') || result.stdout.includes('Error')) {
    // Some other error from setup
    throw new Error(result.stdout);
  }

  // Setup succeeded — parse the token
  try {
    const data = JSON.parse(result.stdout);
    return data.accessToken || '';
  } catch {
    return '';
  }
}

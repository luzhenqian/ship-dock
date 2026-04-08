import React, { useEffect, useState } from 'react';
import { Box, Text, Newline } from 'ink';
import { Credentials } from '../lib/credentials.js';
import { runShell } from '../lib/shell.js';
import { homedir } from 'os';

interface Props {
  config: Credentials;
}

export function Report({ config }: Props) {
  const [publicIp, setPublicIp] = useState('');
  const proto = config.ssl ? 'https' : 'http';

  useEffect(() => {
    if (!config.domain) {
      runShell('curl -sf --max-time 3 https://api.ipify.org').then((r) => {
        if (r.exitCode === 0 && r.stdout) setPublicIp(r.stdout);
      });
    }
  }, []);

  const url = config.domain
    ? `${proto}://${config.domain}`
    : publicIp ? `http://${publicIp}` : 'http://localhost';

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="gray">─────────────────────────────────────────</Text>
      <Newline />
      <Text bold color="green">  ✓ Ship Dock is running!</Text>
      <Newline />
      <Box flexDirection="column" marginLeft={2}>
        <Text bold>Platform</Text>
        <Text>  URL:              {url}</Text>
        <Text>  Frontend:         http://localhost:3000</Text>
        <Text>  API:              http://localhost:{config.port}</Text>
        <Newline />
        <Text bold>Admin</Text>
        <Text>  Email:            {config.adminEmail}</Text>
        <Text>  Password:         {config.adminPassword}</Text>
        <Newline />
        <Text bold>PostgreSQL{config.useExistingDb ? ' (existing)' : ''}</Text>
        <Text>  Host:             {config.dbHost}:{config.dbPort}</Text>
        <Text>  Database:         {config.dbName}</Text>
        <Text>  User:             {config.dbUser}</Text>
        <Text>  Password:         {config.dbPassword}</Text>
        <Newline />
        <Text bold>Redis{config.useExistingRedis ? ' (existing)' : ''}</Text>
        <Text>  Host:             {config.redisHost}:{config.redisPort}</Text>
        <Text>  Password:         {config.redisPassword || '(none)'}</Text>
        <Newline />
        <Text bold>MinIO{config.useExistingMinio ? ' (existing)' : ''}</Text>
        <Text>  Endpoint:         {config.minioEndpoint}:{config.minioPort}</Text>
        <Text>  Access Key:       {config.minioAccessKey}</Text>
        <Text>  Secret Key:       {config.minioSecretKey}</Text>
        <Newline />
        <Text bold>Files</Text>
        <Text>  Backend config:   /opt/shipdock/backend/.env</Text>
        <Text>  Frontend config:  /opt/shipdock/frontend/.env</Text>
        <Text>  Credentials:      {homedir()}/.shipdock/credentials</Text>
        <Text>  PM2 logs:         pm2 logs</Text>
      </Box>
      {config.githubAppId && (
        <>
          <Newline />
          <Text bold>GitHub App</Text>
          <Text>  App ID:           {config.githubAppId}</Text>
          <Text>  Slug:             {config.githubAppSlug}</Text>
        </>
      )}
      {config.googleClientId && (
        <>
          <Newline />
          <Text bold>Google Analytics</Text>
          <Text>  Client ID:        {config.googleClientId}</Text>
          <Text>  Redirect URI:     {url}/api/analytics/callback/google</Text>
        </>
      )}
      {config.microsoftClientId && (
        <>
          <Newline />
          <Text bold>Microsoft Clarity</Text>
          <Text>  Client ID:        {config.microsoftClientId}</Text>
          <Text>  Redirect URI:     {url}/api/analytics/callback/microsoft</Text>
        </>
      )}
      {(!config.githubAppId || !config.googleClientId || !config.microsoftClientId) && (
        <>
          <Newline />
          <Text bold>Next Steps</Text>
          {!config.githubAppId && <Text>  • Configure GitHub App for git-based deployments</Text>}
          {!config.googleClientId && <Text>  • Configure Google Analytics (GA4) integration</Text>}
          {!config.microsoftClientId && <Text>  • Configure Microsoft Clarity integration</Text>}
          <Text>  Edit /opt/shipdock/backend/.env, then: pm2 reload ship-dock-api</Text>
        </>
      )}
      <Newline />
      <Text color="gray">─────────────────────────────────────────</Text>
    </Box>
  );
}

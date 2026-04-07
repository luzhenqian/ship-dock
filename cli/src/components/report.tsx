import React from 'react';
import { Box, Text, Newline } from 'ink';
import { Credentials } from '../lib/credentials.js';
import { homedir } from 'os';

interface Props {
  config: Credentials;
}

export function Report({ config }: Props) {
  const proto = config.ssl ? 'https' : 'http';
  const url = `${proto}://${config.domain}`;

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="gray">─────────────────────────────────────────</Text>
      <Newline />
      <Text bold color="green">  ✓ Ship Dock is running!</Text>
      <Newline />
      <Box flexDirection="column" marginLeft={2}>
        <Text bold>Platform</Text>
        <Text>  URL:              {url}</Text>
        <Text>  API:              http://localhost:{config.port}</Text>
        <Newline />
        <Text bold>Admin</Text>
        <Text>  Email:            {config.adminEmail}</Text>
        <Text>  Password:         {config.adminPassword}</Text>
        <Newline />
        <Text bold>PostgreSQL</Text>
        <Text>  Database:         shipdock</Text>
        <Text>  User:             shipdock</Text>
        <Text>  Password:         {config.dbPassword}</Text>
        <Newline />
        <Text bold>Redis</Text>
        <Text>  Password:         {config.redisPassword || '(none)'}</Text>
        <Newline />
        <Text bold>MinIO</Text>
        <Text>  Console:          http://localhost:9001</Text>
        <Text>  Access Key:       {config.minioAccessKey}</Text>
        <Text>  Secret Key:       {config.minioSecretKey}</Text>
        <Newline />
        <Text bold>Files</Text>
        <Text>  Config:           /opt/shipdock/backend/.env</Text>
        <Text>  Credentials:      {homedir()}/.shipdock/credentials</Text>
        <Text>  Logs:             pm2 logs ship-dock-api</Text>
      </Box>
      <Newline />
      <Text color="gray">─────────────────────────────────────────</Text>
    </Box>
  );
}

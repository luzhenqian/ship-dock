import React from 'react';
import { Box, Text } from 'ink';

export function Header() {
  return (
    <Box marginBottom={1}>
      <Text bold>▲ Ship Dock</Text>
      <Text color="gray">  v1.0.0</Text>
    </Box>
  );
}

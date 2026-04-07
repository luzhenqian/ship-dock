import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';

export type TaskStatus = 'pending' | 'running' | 'done' | 'failed';

interface Props {
  label: string;
  status: TaskStatus;
  detail?: string;
}

export function TaskLine({ label, status, detail }: Props) {
  return (
    <Box>
      {status === 'pending' && <Text color="gray">  ◻ </Text>}
      {status === 'running' && (
        <Box>
          <Text color="cyan">  </Text>
          <Spinner type="dots" />
          <Text> </Text>
        </Box>
      )}
      {status === 'done' && <Text color="green">  ✓ </Text>}
      {status === 'failed' && <Text color="red">  ✗ </Text>}
      <Text>{label}</Text>
      {detail && <Text color="gray"> {detail}</Text>}
    </Box>
  );
}

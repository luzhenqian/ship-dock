import React from 'react';
import { Box, Text } from 'ink';

interface Props {
  label: string;
  value: string;
  masked?: boolean;
}

export function CompletedField({ label, value, masked }: Props) {
  return (
    <Box>
      <Text color="green">✓</Text>
      <Text> {label} </Text>
      <Text color="gray">{masked ? '•'.repeat(value.length) : value}</Text>
    </Box>
  );
}

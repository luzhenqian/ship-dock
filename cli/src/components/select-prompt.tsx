import React from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';

interface Props {
  label: string;
  items: Array<{ label: string; value: string }>;
  onSelect: (value: string) => void;
}

export function SelectPrompt({ label, items, onSelect }: Props) {
  return (
    <Box flexDirection="column">
      <Box>
        <Text color="white">◆</Text>
        <Text> {label}</Text>
      </Box>
      <Box marginLeft={2}>
        <SelectInput
          items={items}
          onSelect={(item) => onSelect(item.value)}
        />
      </Box>
    </Box>
  );
}

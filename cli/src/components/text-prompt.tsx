import React, { useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';

interface Props {
  label: string;
  placeholder?: string;
  defaultValue?: string;
  onSubmit: (value: string) => void;
}

export function TextPrompt({ label, placeholder, defaultValue, onSubmit }: Props) {
  const [value, setValue] = useState(defaultValue ?? '');

  return (
    <Box flexDirection="column">
      <Box>
        <Text color="white">◆</Text>
        <Text> {label}</Text>
      </Box>
      <Box>
        <Text color="gray">│ </Text>
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={() => onSubmit(value)}
          placeholder={placeholder}
        />
      </Box>
    </Box>
  );
}

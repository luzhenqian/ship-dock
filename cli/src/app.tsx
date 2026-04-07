import React, { useReducer } from 'react';
import { Box, Text } from 'ink';

type Phase = 'collecting' | 'confirming' | 'installing' | 'initializing' | 'done';

interface State {
  phase: Phase;
  config: Record<string, string>;
}

type Action =
  | { type: 'SET_CONFIG'; config: Record<string, string> }
  | { type: 'CONFIRM' }
  | { type: 'INSTALL_DONE' }
  | { type: 'INIT_DONE' };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'SET_CONFIG':
      return { ...state, config: action.config, phase: 'confirming' };
    case 'CONFIRM':
      return { ...state, phase: 'installing' };
    case 'INSTALL_DONE':
      return { ...state, phase: 'initializing' };
    case 'INIT_DONE':
      return { ...state, phase: 'done' };
    default:
      return state;
  }
}

export function App() {
  const [state, dispatch] = useReducer(reducer, {
    phase: 'collecting',
    config: {},
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold>▲ Ship Dock</Text>
        <Text color="gray">  v1.0.0</Text>
      </Box>
      <Text color="gray">Phase: {state.phase} (placeholder)</Text>
    </Box>
  );
}

import React, { useReducer } from 'react';
import { Box, useApp } from 'ink';
import { Header } from './components/header.js';
import { Report } from './components/report.js';
import { CollectPhase } from './phases/collect.js';
import { InstallPhase } from './phases/install.js';
import { InitializePhase } from './phases/initialize.js';
import { Credentials } from './lib/credentials.js';

type Phase = 'collecting' | 'confirming' | 'installing' | 'initializing' | 'done';

interface State {
  phase: Phase;
  config: Credentials | null;
}

type Action =
  | { type: 'SET_CONFIG'; config: Credentials }
  | { type: 'INSTALL_DONE' }
  | { type: 'INIT_DONE' };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'SET_CONFIG':
      return { ...state, config: action.config, phase: 'installing' };
    case 'INSTALL_DONE':
      return { ...state, phase: 'initializing' };
    case 'INIT_DONE':
      return { ...state, phase: 'done' };
    default:
      return state;
  }
}

export function App() {
  const { exit } = useApp();
  const [state, dispatch] = useReducer(reducer, {
    phase: 'collecting',
    config: null,
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Header />

      {state.phase === 'collecting' && (
        <CollectPhase
          onComplete={(config) => dispatch({ type: 'SET_CONFIG', config })}
        />
      )}

      {state.phase === 'installing' && (
        <InstallPhase
          onComplete={() => dispatch({ type: 'INSTALL_DONE' })}
        />
      )}

      {state.phase === 'initializing' && state.config && (
        <InitializePhase
          config={state.config}
          onComplete={() => dispatch({ type: 'INIT_DONE' })}
        />
      )}

      {state.phase === 'done' && state.config && (
        <Report config={state.config} />
      )}
    </Box>
  );
}

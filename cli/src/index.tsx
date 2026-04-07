#!/usr/bin/env node
import { Command } from 'commander';
import { render } from 'ink';
import React from 'react';
import { App } from './app.js';

const program = new Command();

program
  .name('shipdock')
  .description('Ship Dock CLI installer')
  .version('1.0.0');

program
  .command('init')
  .description('Initialize Ship Dock on this server')
  .action(() => {
    render(<App />);
  });

program.parse();

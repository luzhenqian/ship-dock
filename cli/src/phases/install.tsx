import React, { useEffect, useState } from 'react';
import { Box, Text, useApp } from 'ink';
import SelectInput from 'ink-select-input';
import { TaskLine, TaskStatus } from '../components/task-line.js';
import { detectAll, Dependency } from '../lib/detect.js';
import { installers, detectPackageManager, PackageManager } from '../lib/installers.js';
import Spinner from 'ink-spinner';

interface Props {
  onComplete: () => void;
}

type Stage = 'detecting' | 'confirming' | 'installing' | 'done';

interface InstallTask {
  name: string;
  status: TaskStatus;
  detail?: string;
}

export function InstallPhase({ onComplete }: Props) {
  const { exit } = useApp();
  const [stage, setStage] = useState<Stage>('detecting');
  const [deps, setDeps] = useState<Dependency[]>([]);
  const [tasks, setTasks] = useState<InstallTask[]>([]);
  const [pm, setPm] = useState<PackageManager>('apt');

  // Detect dependencies
  useEffect(() => {
    (async () => {
      try {
        const detectedPm = await detectPackageManager();
        setPm(detectedPm);
        const detected = await detectAll();
        setDeps(detected);
        setStage('confirming');
      } catch (err: any) {
        setDeps([]);
        setStage('confirming');
      }
    })();
  }, []);

  // Install missing dependencies sequentially
  const runInstall = async () => {
    const missing = deps.filter((d) => !d.installed);
    const taskList: InstallTask[] = missing.map((d) => ({
      name: d.name,
      status: 'pending' as TaskStatus,
    }));
    setTasks(taskList);
    setStage('installing');

    for (let i = 0; i < missing.length; i++) {
      setTasks((prev) =>
        prev.map((t, j) => (j === i ? { ...t, status: 'running' } : t))
      );

      const installer = installers[missing[i].name];
      if (installer) {
        const result = await installer(pm);
        setTasks((prev) =>
          prev.map((t, j) =>
            j === i
              ? {
                  ...t,
                  status: result.success ? 'done' : 'failed',
                  detail: result.success ? undefined : result.error?.slice(0, 80),
                }
              : t
          )
        );
        // Stop on critical failures (PostgreSQL, Redis)
        if (!result.success && (missing[i].name.includes('PostgreSQL') || missing[i].name.includes('Redis'))) {
          return; // Don't call onComplete — stay in failed state
        }
      }
    }

    setStage('done');
    onComplete();
  };

  if (stage === 'detecting') {
    return (
      <Box>
        <Text color="cyan"><Spinner type="dots" /></Text>
        <Text> Detecting installed dependencies...</Text>
      </Box>
    );
  }

  if (stage === 'confirming') {
    const missing = deps.filter((d) => !d.installed);
    const installed = deps.filter((d) => d.installed);

    return (
      <Box flexDirection="column">
        <Text bold>Dependencies:</Text>
        {installed.map((d) => (
          <Box key={d.name}>
            <Text color="green">  ✓ </Text>
            <Text>{d.name}</Text>
            <Text color="gray"> ({d.version ?? 'installed'})</Text>
          </Box>
        ))}
        {missing.map((d) => (
          <Box key={d.name}>
            <Text color="red">  ✗ </Text>
            <Text>{d.name}</Text>
            <Text color="gray"> (will install)</Text>
          </Box>
        ))}
        <Box marginTop={1}>
          {missing.length === 0 ? (
            <Box flexDirection="column">
              <Text color="green">All dependencies installed!</Text>
              <SelectInput
                items={[{ label: 'Continue', value: 'continue' }]}
                onSelect={() => { setStage('done'); onComplete(); }}
              />
            </Box>
          ) : (
            <Box flexDirection="column">
              <Text>Install {missing.length} missing {missing.length === 1 ? 'dependency' : 'dependencies'}?</Text>
              <SelectInput
                items={[
                  { label: 'Yes, install', value: 'yes' },
                  { label: 'Cancel', value: 'no' },
                ]}
                onSelect={(item) => {
                  if (item.value === 'yes') {
                    runInstall();
                  } else {
                    exit();
                  }
                }}
              />
            </Box>
          )}
        </Box>
      </Box>
    );
  }

  // installing or done
  return (
    <Box flexDirection="column">
      <Text bold>Installing dependencies:</Text>
      {tasks.map((t) => (
        <TaskLine key={t.name} label={t.name} status={t.status} detail={t.detail} />
      ))}
    </Box>
  );
}

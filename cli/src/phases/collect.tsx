import React, { useState } from 'react';
import { Box } from 'ink';
import { TextPrompt } from '../components/text-prompt.js';
import { PasswordPrompt } from '../components/password-prompt.js';
import { SelectPrompt } from '../components/select-prompt.js';
import { CompletedField } from '../components/completed-field.js';
import { generateSecret, Credentials } from '../lib/credentials.js';

interface Props {
  onComplete: (config: Credentials) => void;
}

type FieldType = 'text' | 'password' | 'select';

interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  defaultValue?: string;
  items?: Array<{ label: string; value: string }>;
  autoGenerate?: boolean;
  masked?: boolean;
  /** If set, this field is only shown when the condition is met */
  showWhen?: (values: Record<string, string>) => boolean;
}

const yesNo = [{ label: 'Yes', value: 'true' }, { label: 'No', value: 'false' }];
const existingOrNew = [{ label: 'Set up new', value: 'false' }, { label: 'Use existing', value: 'true' }];

const fields: FieldDef[] = [
  // ── Basic ──
  { key: 'adminEmail', label: 'Admin email', type: 'text', defaultValue: 'admin@shipdock.local', placeholder: 'admin@shipdock.local' },
  { key: 'adminPassword', label: 'Admin password', type: 'password', placeholder: 'leave empty to auto-generate', autoGenerate: true, masked: true },
  { key: 'domain', label: 'Domain', type: 'text', placeholder: 'deploy.example.com' },
  { key: 'port', label: 'API port', type: 'text', defaultValue: '4000', placeholder: '4000' },
  { key: 'ssl', label: 'Enable SSL via Let\'s Encrypt?', type: 'select', items: yesNo },

  // ── PostgreSQL ──
  { key: 'useExistingDb', label: 'PostgreSQL', type: 'select', items: existingOrNew },
  { key: 'dbHost', label: 'PostgreSQL host', type: 'text', defaultValue: 'localhost', placeholder: 'localhost', showWhen: (v) => v.useExistingDb === 'true' },
  { key: 'dbPort', label: 'PostgreSQL port', type: 'text', defaultValue: '5432', placeholder: '5432', showWhen: (v) => v.useExistingDb === 'true' },
  { key: 'dbName', label: 'Database name', type: 'text', defaultValue: 'shipdock', placeholder: 'shipdock', showWhen: (v) => v.useExistingDb === 'true' },
  { key: 'dbUser', label: 'Database user', type: 'text', placeholder: 'shipdock', showWhen: (v) => v.useExistingDb === 'true' },
  { key: 'dbPassword', label: 'PostgreSQL password', type: 'password', placeholder: 'leave empty to auto-generate', autoGenerate: true, masked: true },

  // ── Redis ──
  { key: 'useExistingRedis', label: 'Redis', type: 'select', items: existingOrNew },
  { key: 'redisHost', label: 'Redis host', type: 'text', defaultValue: 'localhost', placeholder: 'localhost', showWhen: (v) => v.useExistingRedis === 'true' },
  { key: 'redisPort', label: 'Redis port', type: 'text', defaultValue: '6379', placeholder: '6379', showWhen: (v) => v.useExistingRedis === 'true' },
  { key: 'redisPassword', label: 'Redis password', type: 'password', placeholder: 'leave empty to auto-generate', autoGenerate: true, masked: true },

  // ── MinIO ──
  { key: 'useExistingMinio', label: 'MinIO', type: 'select', items: existingOrNew },
  { key: 'minioEndpoint', label: 'MinIO endpoint', type: 'text', defaultValue: 'localhost', placeholder: 'localhost', showWhen: (v) => v.useExistingMinio === 'true' },
  { key: 'minioPort', label: 'MinIO port', type: 'text', defaultValue: '9000', placeholder: '9000', showWhen: (v) => v.useExistingMinio === 'true' },
  { key: 'minioAccessKey', label: 'MinIO access key', type: 'text', placeholder: 'leave empty to auto-generate', autoGenerate: true },
  { key: 'minioSecretKey', label: 'MinIO secret key', type: 'password', placeholder: 'leave empty to auto-generate', autoGenerate: true, masked: true },

  // ── Secrets ──
  { key: 'jwtSecret', label: 'JWT secret', type: 'password', placeholder: 'leave empty to auto-generate', autoGenerate: true, masked: true },
];

function getVisibleFields(values: Record<string, string>): FieldDef[] {
  return fields.filter((f) => !f.showWhen || f.showWhen(values));
}

export function CollectPhase({ onComplete }: Props) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({});

  const visibleFields = getVisibleFields(values);
  const currentField = visibleFields[currentIndex];

  const requiredFields = new Set<string>();

  const handleSubmit = (key: string, value: string, autoGenerate?: boolean) => {
    // Reject empty required fields — stay on same prompt
    if (value === '' && requiredFields.has(key)) return;
    const finalValue = (value === '' && autoGenerate) ? generateSecret() : value;
    const newValues = { ...values, [key]: finalValue };
    setValues(newValues);

    // Recalculate visible fields with new values
    const nextVisible = getVisibleFields(newValues);
    if (currentIndex + 1 >= nextVisible.length) {
      const v = newValues;
      const creds: Credentials = {
        adminEmail: v.adminEmail,
        adminPassword: v.adminPassword,
        domain: v.domain || '',
        port: v.port || '4000',
        ssl: v.domain ? v.ssl === 'true' : false,
        useExistingDb: v.useExistingDb === 'true',
        dbHost: v.dbHost || 'localhost',
        dbPort: v.dbPort || '5432',
        dbUser: v.dbUser || 'shipdock',
        dbPassword: v.dbPassword,
        dbName: v.dbName || 'shipdock',
        useExistingRedis: v.useExistingRedis === 'true',
        redisHost: v.redisHost || 'localhost',
        redisPort: v.redisPort || '6379',
        redisPassword: v.redisPassword || '',
        useExistingMinio: v.useExistingMinio === 'true',
        minioEndpoint: v.minioEndpoint || 'localhost',
        minioPort: v.minioPort || '9000',
        minioAccessKey: v.minioAccessKey,
        minioSecretKey: v.minioSecretKey,
        jwtSecret: v.jwtSecret,
        jwtRefreshSecret: generateSecret(),
        encryptionKey: generateSecret(64),
      };
      onComplete(creds);
    } else {
      setCurrentIndex(currentIndex + 1);
    }
  };

  const displayLabel = (field: FieldDef, value: string): string => {
    if (field.items) {
      const item = field.items.find((i) => i.value === value);
      return item?.label ?? value;
    }
    return value;
  };

  return (
    <Box flexDirection="column">
      {visibleFields.map((field, i) => {
        if (i < currentIndex) {
          const displayValue = values[field.key] ?? '';
          return <CompletedField key={field.key} label={field.label} value={displayLabel(field, displayValue)} masked={field.masked} />;
        }
        if (i === currentIndex) {
          if (field.type === 'select') {
            return <SelectPrompt key={field.key} label={field.label} items={field.items!} onSelect={(v) => handleSubmit(field.key, v)} />;
          }
          if (field.type === 'password') {
            return <PasswordPrompt key={field.key} label={field.label} placeholder={field.placeholder} onSubmit={(v) => handleSubmit(field.key, v, field.autoGenerate)} />;
          }
          return <TextPrompt key={field.key} label={field.label} placeholder={field.placeholder} defaultValue={field.defaultValue} onSubmit={(v) => handleSubmit(field.key, v, field.autoGenerate)} />;
        }
        return null;
      })}
    </Box>
  );
}

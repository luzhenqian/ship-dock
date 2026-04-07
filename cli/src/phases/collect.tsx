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

interface FieldDef {
  key: keyof Credentials;
  label: string;
  type: 'text' | 'password' | 'select';
  placeholder?: string;
  defaultValue?: string;
  items?: Array<{ label: string; value: string }>;
  autoGenerate?: boolean;
  masked?: boolean;
}

const fields: FieldDef[] = [
  { key: 'adminEmail', label: 'Admin email', type: 'text', placeholder: 'admin@example.com' },
  { key: 'adminPassword', label: 'Admin password', type: 'password' },
  { key: 'domain', label: 'Domain', type: 'text', placeholder: 'deploy.example.com' },
  { key: 'port', label: 'API port', type: 'text', defaultValue: '4000', placeholder: '4000' },
  { key: 'ssl', label: 'Enable SSL via Let\'s Encrypt?', type: 'select', items: [{ label: 'Yes', value: 'true' }, { label: 'No', value: 'false' }] },
  { key: 'dbPassword', label: 'PostgreSQL password', type: 'password', placeholder: 'leave empty to auto-generate', autoGenerate: true, masked: true },
  { key: 'redisPassword', label: 'Redis password', type: 'password', placeholder: 'leave empty to auto-generate', autoGenerate: true, masked: true },
  { key: 'minioAccessKey', label: 'MinIO access key', type: 'text', placeholder: 'leave empty to auto-generate', autoGenerate: true },
  { key: 'minioSecretKey', label: 'MinIO secret key', type: 'password', placeholder: 'leave empty to auto-generate', autoGenerate: true, masked: true },
  { key: 'jwtSecret', label: 'JWT secret', type: 'password', placeholder: 'leave empty to auto-generate', autoGenerate: true, masked: true },
];

export function CollectPhase({ onComplete }: Props) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({});

  const handleSubmit = (key: string, value: string, autoGenerate?: boolean) => {
    const finalValue = (value === '' && autoGenerate) ? generateSecret() : value;
    const newValues = { ...values, [key]: finalValue };
    setValues(newValues);

    if (currentIndex + 1 >= fields.length) {
      // Generate jwtRefreshSecret and encryptionKey automatically
      const creds: Credentials = {
        adminEmail: newValues.adminEmail,
        adminPassword: newValues.adminPassword,
        domain: newValues.domain,
        port: newValues.port || '4000',
        ssl: newValues.ssl === 'true',
        dbPassword: newValues.dbPassword,
        redisPassword: newValues.redisPassword,
        minioAccessKey: newValues.minioAccessKey,
        minioSecretKey: newValues.minioSecretKey,
        jwtSecret: newValues.jwtSecret,
        jwtRefreshSecret: generateSecret(),
        encryptionKey: generateSecret(64),
      };
      onComplete(creds);
    } else {
      setCurrentIndex(currentIndex + 1);
    }
  };

  return (
    <Box flexDirection="column">
      {fields.map((field, i) => {
        if (i < currentIndex) {
          const displayValue = values[field.key] ?? '';
          if (field.key === 'ssl') {
            return <CompletedField key={field.key} label={field.label} value={displayValue === 'true' ? 'Yes' : 'No'} />;
          }
          return <CompletedField key={field.key} label={field.label} value={displayValue} masked={field.masked} />;
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

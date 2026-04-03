import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EncryptionService } from './encryption.service';

describe('EncryptionService', () => {
  let service: EncryptionService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        EncryptionService,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: () => 'a'.repeat(64), // 32 bytes hex
          },
        },
      ],
    }).compile();
    service = module.get(EncryptionService);
  });

  it('encrypts and decrypts a string', () => {
    const plaintext = '{"DB_HOST":"localhost","DB_PASS":"secret123"}';
    const encrypted = service.encrypt(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(service.decrypt(encrypted)).toBe(plaintext);
  });

  it('produces different ciphertext each time (random IV)', () => {
    const plaintext = 'hello';
    const a = service.encrypt(plaintext);
    const b = service.encrypt(plaintext);
    expect(a).not.toBe(b);
  });

  it('masks a string showing last 4 chars', () => {
    expect(service.mask('abcdefgh1234')).toBe('****1234');
  });
});

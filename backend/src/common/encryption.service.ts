import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

@Injectable()
export class EncryptionService {
  private readonly key: Buffer;

  constructor(private config: ConfigService) {
    this.key = Buffer.from(this.config.getOrThrow<string>('ENCRYPTION_KEY'), 'hex');
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-cbc', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
  }

  decrypt(ciphertext: string): string {
    const [ivHex, encHex] = ciphertext.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const encrypted = Buffer.from(encHex, 'hex');
    const decipher = createDecipheriv('aes-256-cbc', this.key, iv);
    return decipher.update(encrypted) + decipher.final('utf8');
  }

  mask(value: string): string {
    if (value.length <= 4) return '****';
    return '****' + value.slice(-4);
  }
}

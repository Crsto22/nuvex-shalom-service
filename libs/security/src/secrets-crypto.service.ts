import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';
const IV_BYTES = 12;

/**
 * Cifra secretos recuperables (contrasenas de Shalom) con AES-256-GCM.
 *
 * Formato: v1.<iv>.<authTag>.<ciphertext>  (cada parte en base64url)
 *
 * El `context` funciona como AAD: por ejemplo `tenant:<id>:shalom-password`.
 * Descifrar con otro contexto falla, lo que impide reutilizar ciphertexts
 * entre tenants o propositos.
 */
@Injectable()
export class SecretsCryptoService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const raw = config.get<string>('SECRETS_ENCRYPTION_KEY') ?? '';
    const decoded = Buffer.from(raw, 'base64');
    if (decoded.length !== 32) {
      throw new Error('SECRETS_ENCRYPTION_KEY debe ser 32 bytes en base64');
    }
    this.key = decoded;
  }

  encrypt(plaintext: string, context: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    cipher.setAAD(Buffer.from(context, 'utf8'));

    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return [
      VERSION,
      iv.toString('base64url'),
      tag.toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.');
  }

  decrypt(payload: string, context: string): string {
    const parts = payload.split('.');
    if (parts.length !== 4 || parts[0] !== VERSION) {
      throw new Error('Formato de secreto cifrado invalido');
    }

    const [, ivPart, tagPart, dataPart] = parts;
    if (!ivPart || !tagPart || !dataPart) {
      throw new Error('Formato de secreto cifrado invalido');
    }

    const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(ivPart, 'base64url'));
    decipher.setAAD(Buffer.from(context, 'utf8'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));

    return Buffer.concat([
      decipher.update(Buffer.from(dataPart, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  /** Comparacion en tiempo constante para tokens. */
  safeEqual(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    if (left.length !== right.length) return false;
    return timingSafeEqual(left, right);
  }
}

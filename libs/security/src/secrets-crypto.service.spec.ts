import type { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';

import { SecretsCryptoService } from './secrets-crypto.service';

function buildService(keyBase64 = randomBytes(32).toString('base64')) {
  const config = {
    get: (name: string) => (name === 'SECRETS_ENCRYPTION_KEY' ? keyBase64 : undefined),
  } as unknown as ConfigService;

  return new SecretsCryptoService(config);
}

describe('SecretsCryptoService', () => {
  it('cifra y descifra con el mismo contexto', () => {
    const service = buildService();
    const secret = 'mi-password-shalom';

    const encrypted = service.encrypt(secret, 'tenant:abc:shalom-password');

    expect(encrypted.startsWith('v1.')).toBe(true);
    expect(encrypted).not.toContain(secret);
    expect(service.decrypt(encrypted, 'tenant:abc:shalom-password')).toBe(secret);
  });

  it('falla al descifrar con otro contexto', () => {
    const service = buildService();
    const encrypted = service.encrypt('secreto', 'tenant:abc:shalom-password');

    expect(() => service.decrypt(encrypted, 'tenant:otro:shalom-password')).toThrow();
  });

  it('falla al descifrar con otra clave', () => {
    const first = buildService();
    const encrypted = first.encrypt('secreto', 'ctx');

    expect(() => buildService().decrypt(encrypted, 'ctx')).toThrow();
  });

  it('rechaza una clave que no sea de 32 bytes', () => {
    const shortKey = randomBytes(16).toString('base64');

    expect(() => buildService(shortKey)).toThrow(/32 bytes/);
  });
});

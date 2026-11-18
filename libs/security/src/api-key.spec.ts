import { generateApiKey, hasScopes, hashApiKey } from './api-key';

const PEPPER = 'pepper-de-prueba-con-mas-de-32-caracteres';

describe('api-key', () => {
  it('genera una key con prefijo visible y hash estable', () => {
    const key = generateApiKey(PEPPER, 'production');

    expect(key.plain.startsWith('shm_live_')).toBe(true);
    expect(key.prefix).toBe(key.plain.slice(0, 18));
    expect(key.hashedKey).toHaveLength(64);
    expect(hashApiKey(PEPPER, key.plain)).toBe(key.hashedKey);
  });

  it('usa prefijo distinto en sandbox', () => {
    expect(generateApiKey(PEPPER, 'sandbox').plain.startsWith('shm_test_')).toBe(true);
  });

  it('el hash depende del pepper', () => {
    const key = generateApiKey(PEPPER, 'production');

    expect(hashApiKey('otro-pepper', key.plain)).not.toBe(key.hashedKey);
  });

  it('valida scopes requeridos', () => {
    expect(hasScopes(['shalom:orders:write', 'shalom:tracking:read'], ['shalom:orders:write'])).toBe(true);
    expect(hasScopes(['shalom:tracking:read'], ['shalom:orders:write'])).toBe(false);
  });
});

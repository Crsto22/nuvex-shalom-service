import { securityKeyIssue } from './security-key';

describe('securityKeyIssue', () => {
  it('acepta una clave valida', () => {
    expect(securityKeyIssue('9872')).toBeNull();
    expect(securityKeyIssue('1948')).toBeNull();
  });

  it('exige exactamente 4 digitos', () => {
    expect(securityKeyIssue('123')).toMatch(/4 digitos/);
    expect(securityKeyIssue('12345')).toMatch(/4 digitos/);
    expect(securityKeyIssue('12a4')).toMatch(/4 digitos/);
  });

  it('rechaza claves consecutivas', () => {
    expect(securityKeyIssue('1234')).toMatch(/consecutivas/);
    expect(securityKeyIssue('4321')).toMatch(/consecutivas/);
  });

  it('rechaza claves con el mismo digito repetido', () => {
    expect(securityKeyIssue('1111')).toMatch(/repetido/);
    expect(securityKeyIssue('0000')).toMatch(/repetido/);
  });
});

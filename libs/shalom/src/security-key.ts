/**
 * Reglas de negocio de la clave de seguridad de Shalom.
 *
 * Shalom rechaza claves consecutivas (1234, 4321) y con un solo digito repetido (1111).
 * Validar antes de encolar evita gastar una sesion y un intento del job.
 */
export function securityKeyIssue(key: string): string | null {
  if (!/^\d{4}$/.test(key)) {
    return 'La clave de seguridad debe tener exactamente 4 digitos';
  }

  const digits = key.split('').map(Number);
  if (new Set(digits).size === 1) {
    return 'Shalom rechaza claves con el mismo digito repetido';
  }

  const consecutive = digits.every((digit, index) => {
    if (index === 0) return true;
    const previous = digits[index - 1] ?? 0;
    return Math.abs(digit - previous) === 1;
  });

  if (consecutive) {
    return 'Shalom rechaza claves consecutivas (ej. 1234); use otra combinacion';
  }

  return null;
}

export const PACKAGE_TYPES = [
  'SOBRE',
  'PAQUETE XXS',
  'PAQUETE XS',
  'PAQUETE S',
  'PAQUETE M',
  'PAQUETE L',
] as const;

export type PackageType = (typeof PACKAGE_TYPES)[number];

export const DECLARATION_TYPES = [
  'Articulos de uso personal',
  'Documentos',
  'Ropa',
  'Electrodomesticos',
] as const;

export type DeclarationType = (typeof DECLARATION_TYPES)[number];

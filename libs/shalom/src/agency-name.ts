/**
 * El directorio de Shalom publica agencias con el sufijo "(POR DEFINIR)",
 * mientras que el formulario de registro las muestra con el nombre limpio.
 *
 * Ejemplo: "ANCASH / HUARAZ / INDEPENDENCIA / HUARAZ PALMIRA (POR DEFINIR)"
 * -> "HUARAZ PALMIRA"
 */
export function stripAgencyPlaceholder(name: string): string {
  return name
    .replace(/\s*\(\s*por definir\s*\)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

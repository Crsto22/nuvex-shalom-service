import fs from 'node:fs';
import path from 'node:path';

const CHROME_DIRS = [
  'C:\\Program Files\\Google\\Chrome\\Application',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application',
  path.join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application'),
];

/**
 * Shalom responde 403 cuando el User-Agent contiene "HeadlessChrome".
 * Se detecta la version real de Chrome instalada y se arma un UA normal.
 * En Linux (contenedor) se usa el valor por defecto o SHALOM_USER_AGENT.
 */
export function resolveUserAgent(): string {
  const fromEnv = process.env.SHALOM_USER_AGENT?.trim();
  if (fromEnv) return fromEnv;

  const versions: number[][] = [];
  for (const dir of CHROME_DIRS) {
    if (!dir) continue;
    try {
      for (const entry of fs.readdirSync(dir)) {
        const match = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(entry);
        if (match) versions.push(match.slice(1).map(Number));
      }
    } catch {
      continue;
    }
  }

  const latest = versions.sort((a, b) => {
    for (let i = 0; i < 4; i += 1) {
      const diff = (b[i] ?? 0) - (a[i] ?? 0);
      if (diff !== 0) return diff;
    }
    return 0;
  })[0];

  const major = latest?.[0] ?? 141;
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

import 'reflect-metadata';

/**
 * Verifica /v1/health y falla (exit 1) si hay algo que atender.
 * Pensado para un cron / Programador de tareas que avise por email o Slack.
 *
 * Uso: node --env-file=.env scripts/check-alerts.mjs
 *   o: node scripts/check-alerts.mjs --url http://127.0.0.1:4110
 */
function arg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

const url = (arg('--url') ?? process.env.ALERT_HEALTH_URL ?? 'http://127.0.0.1:4110').replace(/\/$/, '');
const maxDead = Number(process.env.ALERT_MAX_DEAD_JOBS ?? 0);

async function main() {
  const response = await fetch(`${url}/v1/health`, {
    signal: AbortSignal.timeout(10_000),
  }).catch((error) => {
    console.error(`ALERTA: no se pudo consultar ${url} (${(error as Error).message})`);
    process.exit(1);
  });

  if (!response.ok) {
    console.error(`ALERTA: health respondio ${response.status}`);
    process.exit(1);
  }

  const body = (await response.json()) as {
    status: string;
    database: string;
    metrics?: {
      sessions?: { active?: number; requiresLogin?: number };
      jobs?: { pending?: number; processing?: number; dead?: number };
    };
  };

  const problems: string[] = [];

  if (body.status !== 'ok') problems.push(`estado del servicio: ${body.status}`);
  if (body.database !== 'up') problems.push('base de datos caida');

  const requiresLogin = body.metrics?.sessions?.requiresLogin ?? 0;
  if (requiresLogin > 0) {
    problems.push(`${requiresLogin} empresa(s) requieren login manual de Shalom`);
  }

  const dead = body.metrics?.jobs?.dead ?? 0;
  if (dead > maxDead) problems.push(`${dead} job(s) en DEAD`);

  if (problems.length > 0) {
    console.error(`ALERTA (${url})`);
    for (const problem of problems) console.error(` - ${problem}`);
    process.exit(1);
  }

  console.log(
    `OK ${url} · sesiones activas=${body.metrics?.sessions?.active ?? 0} · pendientes=${body.metrics?.jobs?.pending ?? 0}`,
  );
}

main().catch((error) => {
  console.error(`ALERTA: ${(error as Error).message}`);
  process.exit(1);
});

import 'reflect-metadata';

import { PrismaClient } from '@prisma/client';

/** Marca la sesion del tenant como EXPIRED para probar el re-login automatico. */
async function main() {
  const prisma = new PrismaClient();

  const tenant = await prisma.tenant.findUnique({ where: { code: 'nobitex' } });
  if (!tenant) throw new Error('tenant nobitex no existe');

  await prisma.shalomSession.update({
    where: { tenantId: tenant.id },
    data: { status: 'EXPIRED', lastError: 'simulada expirada por prueba' },
  });

  console.log(`Sesion de ${tenant.code} marcada EXPIRED`);
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

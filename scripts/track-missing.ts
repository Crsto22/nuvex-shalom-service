import 'reflect-metadata';

import { PrismaClient } from '@prisma/client';

/** Encola rastreo para las ordenes sin rastrear (util tras importar). */
async function main() {
  const prisma = new PrismaClient();

  const orders = await prisma.shalomOrder.findMany({
    where: { lastTrackedAt: null, orden: { not: null } },
    select: { id: true, tenantId: true, orden: true },
  });

  console.log(`ordenes sin rastrear: ${orders.length}`);

  for (const order of orders) {
    try {
      await prisma.shalomJob.create({
        data: { tenantId: order.tenantId, type: 'TRACKING', payload: { orderId: order.id } },
      });
      console.log(`  encolado ${order.orden}`);
    } catch (error) {
      console.log(`  ${order.orden}: ${(error as Error).message}`);
    }
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

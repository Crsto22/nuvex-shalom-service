import 'reflect-metadata';

import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();

  const orders = await prisma.shalomOrder.findMany({
    orderBy: { createdAt: 'desc' },
    take: 6,
    select: {
      orden: true,
      codigo: true,
      status: true,
      trackingStatus: true,
      trackingProgress: true,
      lastTrackedAt: true,
      createdAt: true,
    },
  });

  console.log('=== ultimas ordenes ===');
  for (const order of orders) {
    console.log(
      `${order.orden ?? '-'} / ${order.codigo ?? '-'} · estado=${order.status} · tracking=${order.trackingStatus ?? 'sin rastrear'} ` +
        `(${order.trackingProgress ?? '-'}) · lastTrackedAt=${order.lastTrackedAt?.toISOString() ?? '-'} · creada=${order.createdAt.toISOString()}`,
    );
  }

  const jobs = await prisma.shalomJob.findMany({
    orderBy: { createdAt: 'desc' },
    take: 8,
    select: { type: true, status: true, errorMessage: true, createdAt: true },
  });

  console.log('\n=== ultimos jobs ===');
  for (const job of jobs) {
    console.log(`${job.type} · ${job.status} · ${job.errorMessage ?? '-'} · ${job.createdAt.toISOString()}`);
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

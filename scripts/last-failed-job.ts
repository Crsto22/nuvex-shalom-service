import 'reflect-metadata';

import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();

  const job = await prisma.shalomJob.findFirst({
    where: { type: 'REGISTER_ORDER', status: 'DEAD' },
    orderBy: { createdAt: 'desc' },
    select: { id: true, errorMessage: true, payload: true, createdAt: true },
  });

  console.log(JSON.stringify(job, null, 2));
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

import 'reflect-metadata';

import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';

import { API_KEY_SCOPES, generateApiKey } from '../libs/security/src/api-key';
import { SecretsCryptoService } from '../libs/security/src/secrets-crypto.service';

/**
 * Crea (o actualiza) un tenant con sus credenciales de Shalom, una aplicacion
 * consumidora y su primera API key.
 *
 * Uso:
 *   node --env-file=.env -r ts-node/register scripts/create-tenant.ts \
 *     --code nobitex --name "Nobitex" --email cuenta@empresa.com --password ****
 */
function arg(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

async function main() {
  const prisma = new PrismaClient();
  const crypto = new SecretsCryptoService(new ConfigService(process.env));

  const code = (arg('--code') ?? 'nobitex').toLowerCase();
  const name = arg('--name') ?? code;
  const email = arg('--email');
  const password = arg('--password');
  const applicationCode = (arg('--app') ?? 'nuvex').toLowerCase();

  try {
    const tenant = await prisma.tenant.upsert({
      where: { code },
      create: { code, name },
      update: { name },
    });

    if (email && password) {
      const encrypted = crypto.encrypt(password, `tenant:${tenant.id}:shalom-password`);
      await prisma.shalomCredential.upsert({
        where: { tenantId: tenant.id },
        create: { tenantId: tenant.id, username: email, encryptedPassword: encrypted },
        update: { username: email, encryptedPassword: encrypted },
      });
      console.log(`Credenciales guardadas para ${code} (${email})`);
    } else {
      console.log('Sin --email/--password: no se guardaron credenciales');
    }

    const application = await prisma.application.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: applicationCode } },
      create: { tenantId: tenant.id, code: applicationCode, name: applicationCode },
      update: {},
    });

    const pepper = process.env.API_KEY_PEPPER ?? '';
    if (pepper.length < 32) {
      console.log('API_KEY_PEPPER invalido: no se genero API key');
    } else {
      const key = generateApiKey(pepper, 'production');
      await prisma.apiKey.create({
        data: {
          applicationId: application.id,
          prefix: key.prefix,
          hashedKey: key.hashedKey,
          scopes: [...API_KEY_SCOPES],
        },
      });
      console.log(`\nAPI key (se muestra una sola vez): ${key.plain}`);
    }

    console.log(`\ntenantId: ${tenant.id}`);
    console.log(`applicationId: ${application.id}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

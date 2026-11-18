import 'reflect-metadata';

import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

import { API_KEY_SCOPES, generateApiKey } from '../libs/security/src/api-key';
import { SecretsCryptoService } from '../libs/security/src/secrets-crypto.service';

/**
 * Deja el servicio listo para usar desde la consola HTML:
 * - crea/actualiza el tenant de la empresa
 * - guarda (cifradas) las credenciales de Shalom
 * - crea la aplicacion y una API key nueva
 * - escribe los valores en .env
 *
 * Uso: node --env-file=.env -r ts-node/register/transpile-only scripts/bootstrap.ts
 */
function arg(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

function upsertEnvLine(content: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  if (new RegExp(`^${key}=.*$`, 'm').test(content)) {
    return content.replace(new RegExp(`^${key}=.*$`, 'm'), line);
  }
  return `${content.trimEnd()}\r\n${line}\r\n`;
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('bootstrap es una herramienta de desarrollo; no se ejecuta en produccion');
  }

  const prisma = new PrismaClient();
  const crypto = new SecretsCryptoService(new ConfigService(process.env));

  const code = (arg('--code', process.env.TENANT_CODE ?? 'nobitex') ?? 'nobitex').toLowerCase();
  const name = arg('--name', process.env.TENANT_NAME ?? 'Nobitex') ?? 'Nobitex';
  const email = arg('--email', process.env.SHALOM_EMAIL);
  const password = arg('--password', process.env.SHALOM_PASSWORD);
  const applicationCode = (arg('--app', 'nuvex') ?? 'nuvex').toLowerCase();

  try {
    const tenant = await prisma.tenant.upsert({
      where: { code },
      create: { code, name },
      update: { name },
    });

    if (email && password) {
      await prisma.shalomCredential.upsert({
        where: { tenantId: tenant.id },
        create: {
          tenantId: tenant.id,
          username: email,
          encryptedPassword: crypto.encrypt(password, `tenant:${tenant.id}:shalom-password`),
        },
        update: {
          username: email,
          encryptedPassword: crypto.encrypt(password, `tenant:${tenant.id}:shalom-password`),
        },
      });
      console.log(`Credenciales guardadas: ${email}`);
    } else {
      console.log('Sin SHALOM_EMAIL/SHALOM_PASSWORD: configura las credenciales desde la consola');
    }

    const application = await prisma.application.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: applicationCode } },
      create: { tenantId: tenant.id, code: applicationCode, name: applicationCode },
      update: {},
    });

    // Rotacion limpia: se revocan las keys anteriores de esta aplicacion.
    await prisma.apiKey.updateMany({
      where: { applicationId: application.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    const pepper = process.env.API_KEY_PEPPER ?? '';
    if (pepper.length < 32) throw new Error('API_KEY_PEPPER invalido (minimo 32 caracteres)');

    const key = generateApiKey(pepper, 'production');
    await prisma.apiKey.create({
      data: {
        applicationId: application.id,
        prefix: key.prefix,
        hashedKey: key.hashedKey,
        environment: 'PRODUCTION',
        scopes: [...API_KEY_SCOPES],
      },
    });

    // ADMIN_TOKEN
    let adminToken = process.env.ADMIN_TOKEN?.trim() ?? '';
    const envPath = path.join(process.cwd(), '.env');
    let envContent = fs.readFileSync(envPath, 'utf8');

    if (!adminToken) {
      adminToken = randomBytes(24).toString('hex');
      envContent = upsertEnvLine(envContent, 'ADMIN_TOKEN', adminToken);
    }

    const port = process.env.API_PORT ?? '4100';
    const baseUrl = `http://localhost:${port}`;

    envContent = upsertEnvLine(envContent, 'SHALOM_TENANT_ID', tenant.id);
    envContent = upsertEnvLine(envContent, 'SHALOM_APPLICATION_ID', application.id);
    envContent = upsertEnvLine(envContent, 'SHALOM_API_KEY', key.plain);
    fs.writeFileSync(envPath, envContent, 'utf8');

    console.log('');
    console.log('================================================');
    console.log(`Tenant        : ${tenant.id} (${code})`);
    console.log(`Application   : ${application.id} (${applicationCode})`);
    console.log(`API key       : ${key.prefix}...`);
    console.log(`API           : ${baseUrl}`);
    console.log('================================================');
    console.log('Listo: usa la API con Authorization: Bearer (la key completa esta en .env)');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

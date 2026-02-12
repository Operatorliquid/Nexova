import { PrismaClient } from '@prisma/client';
import { createCipheriv, randomBytes } from 'crypto';
import fs from 'fs';

function loadDotEnv() {
  if (process.env.ENCRYPTION_KEY) return;
  if (!fs.existsSync('.env')) return;
  const lines = fs.readFileSync('.env', 'utf8').split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const [key, ...rest] = line.split('=');
    if (!process.env[key]) {
      process.env[key] = rest.join('=').trim();
    }
  }
}

async function main() {
  loadDotEnv();

  if (!process.env.ENCRYPTION_KEY) {
    throw new Error('ENCRYPTION_KEY not set. Cannot encrypt WhatsApp API keys.');
  }

  const keyBuffer = Buffer.from(process.env.ENCRYPTION_KEY, 'base64');
  if (keyBuffer.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be 32 bytes base64-encoded.');
  }

  const prisma = new PrismaClient();

  try {
    const columnExists = await prisma.$queryRaw<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'whatsapp_numbers'
          AND column_name = 'api_key'
      ) AS "exists"
    `;

    if (!columnExists[0]?.exists) {
      console.log('No api_key column found. Nothing to backfill.');
      return;
    }

    const numbers = await prisma.$queryRaw<{
      id: string;
      phoneNumber: string;
      apiKey: string | null;
      apiKeyEnc: string | null;
      apiKeyIv: string | null;
    }[]>`
      SELECT
        id,
        phone_number AS "phoneNumber",
        api_key AS "apiKey",
        api_key_enc AS "apiKeyEnc",
        api_key_iv AS "apiKeyIv"
      FROM whatsapp_numbers
      WHERE api_key IS NOT NULL
        AND (api_key_enc IS NULL OR api_key_enc = '')
    `;

    let updated = 0;

    for (const number of numbers) {
      if (!number.apiKey || number.apiKeyEnc) {
        continue;
      }

      const iv = randomBytes(16);
      const cipher = createCipheriv('aes-256-gcm', keyBuffer, iv);
      let encrypted = cipher.update(number.apiKey, 'utf8', 'base64');
      encrypted += cipher.final('base64');
      const authTag = cipher.getAuthTag();
      const encryptedWithTag = Buffer.concat([
        Buffer.from(encrypted, 'base64'),
        authTag,
      ]).toString('base64');

      await prisma.$executeRaw`
        UPDATE "whatsapp_numbers"
        SET
          "api_key" = NULL,
          "api_key_enc" = ${encryptedWithTag},
          "api_key_iv" = ${iv.toString('hex')}
        WHERE "id" = ${number.id}
      `;

      updated++;
      console.log(`Migrated WhatsAppNumber ${number.phoneNumber}`);
    }

    console.log(`Done. Updated ${updated} WhatsApp numbers.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

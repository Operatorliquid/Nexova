import { spawn } from 'node:child_process';

function buildDatabaseUrl(baseUrl, connectionLimit, poolTimeout) {
  try {
    const url = new URL(baseUrl);
    if (!url.searchParams.has('connection_limit')) {
      url.searchParams.set('connection_limit', connectionLimit);
    }
    if (!url.searchParams.has('pool_timeout')) {
      url.searchParams.set('pool_timeout', poolTimeout);
    }
    return url.toString();
  } catch {
    return baseUrl;
  }
}

const rawDatabaseUrl = process.env.DATABASE_URL;
if (!rawDatabaseUrl || !rawDatabaseUrl.trim()) {
  console.error('DATABASE_URL is required to run migrations.');
  process.exit(1);
}

const migrateConnectionLimit = (process.env.PRISMA_MIGRATE_CONNECTION_LIMIT || '1').trim();
const migratePoolTimeout = (process.env.PRISMA_MIGRATE_POOL_TIMEOUT || '20').trim();
const safeDatabaseUrl = buildDatabaseUrl(
  rawDatabaseUrl,
  migrateConnectionLimit,
  migratePoolTimeout
);

const child = spawn(
  process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  ['exec', 'prisma', 'migrate', 'deploy'],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: safeDatabaseUrl,
    },
  }
);

child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});

child.on('exit', (code) => {
  process.exit(code ?? 1);
});

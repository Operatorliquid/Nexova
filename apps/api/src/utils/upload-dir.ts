import { existsSync } from 'fs';
import path from 'path';

const KNOWN_UPLOAD_SUBDIRECTORIES = [
  'products',
  'catalogs',
  'orders',
  'invoices',
  'receipts',
  'stock-receipts',
  'whatsapp-media',
] as const;

function normalizePath(value: string): string {
  return value.replace(/[\\/]+$/, '');
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  paths.forEach((candidate) => {
    const normalized = normalizePath(candidate);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    result.push(normalized);
  });

  return result;
}

function scoreUploadDirectory(candidate: string): number {
  if (!existsSync(candidate)) return -1;

  let score = 1;
  KNOWN_UPLOAD_SUBDIRECTORIES.forEach((folder) => {
    if (existsSync(path.join(candidate, folder))) {
      score += 1;
    }
  });

  return score;
}

export function resolveUploadDirCandidates(currentDir: string): string[] {
  const configured = (process.env.UPLOAD_DIR || '').trim();
  if (configured) return [configured];

  const cwd = process.cwd();
  const candidates = uniquePaths([
    // Recommended persistent mount path on Railway.
    '/data/uploads',
    path.resolve(cwd, 'uploads'),
    path.resolve(cwd, '..', 'uploads'),
    path.resolve(cwd, '..', '..', 'uploads'),
    path.resolve(cwd, '..', '..', '..', 'uploads'),
    path.resolve(cwd, 'apps', 'api', 'uploads'),
    path.resolve(cwd, 'apps', 'api', 'dist', 'uploads'),
    path.resolve(cwd, 'apps', 'worker', 'apps', 'api', 'uploads'),
    path.resolve(cwd, '..', 'apps', 'api', 'uploads'),
    path.resolve(currentDir, '..', 'uploads'),
    path.resolve(currentDir, '..', '..', 'uploads'),
    path.resolve(currentDir, '..', '..', '..', 'uploads'),
  ]);

  return [...candidates].sort((a, b) => scoreUploadDirectory(b) - scoreUploadDirectory(a));
}

export function resolveUploadDir(currentDir: string): string {
  const candidates = resolveUploadDirCandidates(currentDir);
  return candidates[0] || path.resolve(process.cwd(), 'uploads');
}

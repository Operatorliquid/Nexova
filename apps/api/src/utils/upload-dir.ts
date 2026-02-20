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
  return value.replace(/[\\/]+$/, '') || value;
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

function resolveRailwayVolumeMountPath(): string | null {
  const raw = (process.env.RAILWAY_VOLUME_MOUNT_PATH || '').trim();
  if (!raw) return null;
  return normalizePath(path.resolve(raw));
}

function buildRailwayVolumeCandidates(railwayMountPath: string | null): string[] {
  if (!railwayMountPath) return [];
  const normalized = normalizePath(railwayMountPath);
  const withUploads = normalized.endsWith('/uploads')
    ? normalized
    : normalizePath(path.join(normalized, 'uploads'));
  return uniquePaths([withUploads, normalized]);
}

function buildDefaultUploadDirCandidates(currentDir: string, railwayMountPath: string | null): string[] {
  const cwd = process.cwd();
  const railwayCandidates = buildRailwayVolumeCandidates(railwayMountPath);
  return uniquePaths([
    ...railwayCandidates,
    // Recommended persistent mount path on Railway.
    '/data/uploads',
    '/data',
    '/uploads',
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
}

export function resolveUploadDirCandidates(currentDir: string): string[] {
  const configuredRaw = (process.env.UPLOAD_DIR || '').trim();
  const configured = configuredRaw ? normalizePath(path.resolve(configuredRaw)) : '';
  const railwayMountPath = resolveRailwayVolumeMountPath();
  const railwayCandidates = buildRailwayVolumeCandidates(railwayMountPath);
  const railwayCandidateSet = new Set(railwayCandidates.map((entry) => normalizePath(entry)));
  const defaults = [...buildDefaultUploadDirCandidates(currentDir, railwayMountPath)];

  const rankCandidate = (candidate: string): number => {
    const normalized = normalizePath(candidate);
    let score = scoreUploadDirectory(normalized);
    const candidateExists = existsSync(normalized);
    if (configured && normalized === configured) score += 10_000;
    if (railwayCandidateSet.has(normalized)) score += 8_000;
    if (candidateExists && (normalized === '/data/uploads' || normalized === '/data')) score += 2_000;
    return score;
  };

  const sortedDefaults = defaults.sort((a, b) => rankCandidate(b) - rankCandidate(a));

  if (configured) {
    return uniquePaths([configured, ...sortedDefaults]);
  }

  return sortedDefaults;
}

export function resolveUploadDir(currentDir: string): string {
  const candidates = resolveUploadDirCandidates(currentDir);
  return candidates[0] || path.resolve(process.cwd(), 'uploads');
}

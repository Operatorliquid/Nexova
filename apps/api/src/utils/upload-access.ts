import { createHmac, timingSafeEqual } from 'crypto';

const SAFE_CATEGORY_PATTERN = /^[a-z0-9-]{1,64}$/;
const SAFE_FILENAME_PATTERN = /^[a-zA-Z0-9._-]{1,255}$/;
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

const DEFAULT_SIGNED_UPLOAD_TTL_SECONDS = 60 * 60 * 24 * 7; // 7d
const MIN_SIGNED_UPLOAD_TTL_SECONDS = 30;
const MAX_SIGNED_UPLOAD_TTL_SECONDS = 60 * 60 * 24 * 30; // 30d

export const DOWNLOADABLE_UPLOAD_CATEGORIES = new Set([
  'products',
  'catalogs',
  'orders',
  'statements',
  'invoices',
  'receipts',
  'stock-receipts',
  'whatsapp-media',
]);

function normalizeTtlSeconds(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SIGNED_UPLOAD_TTL_SECONDS;
  const parsed = Math.trunc(value);
  if (parsed < MIN_SIGNED_UPLOAD_TTL_SECONDS) return MIN_SIGNED_UPLOAD_TTL_SECONDS;
  if (parsed > MAX_SIGNED_UPLOAD_TTL_SECONDS) return MAX_SIGNED_UPLOAD_TTL_SECONDS;
  return parsed;
}

export function resolveSignedUploadTtlSeconds(): number {
  const raw = Number(process.env.UPLOAD_SIGNED_URL_TTL_SECONDS || DEFAULT_SIGNED_UPLOAD_TTL_SECONDS);
  return normalizeTtlSeconds(raw);
}

export function sanitizeUploadCategory(value: string): string | null {
  const normalized = (value || '').trim().toLowerCase();
  if (!SAFE_CATEGORY_PATTERN.test(normalized)) return null;
  return normalized;
}

export function sanitizeUploadFilename(value: string): string | null {
  let normalized = (value || '').trim();
  try {
    normalized = decodeURIComponent(normalized);
  } catch {
    return null;
  }
  if (!SAFE_FILENAME_PATTERN.test(normalized)) return null;
  return normalized;
}

function resolveSigningSecret(): string {
  return (
    process.env.UPLOAD_URL_SIGNING_SECRET
    || process.env.JWT_SECRET
    || process.env.COOKIE_SECRET
    || ''
  ).trim();
}

function buildSignature(category: string, filename: string, expSeconds: number, secret: string): string {
  return createHmac('sha256', secret)
    .update(`${category}/${filename}:${expSeconds}`)
    .digest('hex');
}

function ensureLeadingSlash(value: string): string {
  if (!value) return '/';
  return value.startsWith('/') ? value : `/${value}`;
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

export function buildUploadProxyPath(category: string, filename: string): string {
  const safeCategory = sanitizeUploadCategory(category);
  const safeFilename = sanitizeUploadFilename(filename);
  if (!safeCategory || !safeFilename) {
    throw new Error('INVALID_UPLOAD_PATH');
  }
  return `/api/v1/uploads/file/${encodePathSegment(safeCategory)}/${encodePathSegment(safeFilename)}`;
}

export function buildSignedUploadPath(params: {
  category: string;
  filename: string;
  ttlSeconds?: number;
}): string {
  const { category, filename } = params;
  const ttlSeconds = normalizeTtlSeconds(params.ttlSeconds ?? resolveSignedUploadTtlSeconds());
  const safeCategory = sanitizeUploadCategory(category);
  const safeFilename = sanitizeUploadFilename(filename);
  if (!safeCategory || !safeFilename) {
    throw new Error('INVALID_UPLOAD_PATH');
  }

  const expSeconds = Math.floor(Date.now() / 1000) + ttlSeconds;
  const secret = resolveSigningSecret();
  if (!secret) {
    return buildUploadProxyPath(safeCategory, safeFilename);
  }

  const sig = buildSignature(safeCategory, safeFilename, expSeconds, secret);
  const basePath = buildUploadProxyPath(safeCategory, safeFilename);
  return `${basePath}?exp=${expSeconds}&sig=${sig}`;
}

export function buildSignedUploadUrl(params: {
  baseUrl: string;
  category: string;
  filename: string;
  ttlSeconds?: number;
}): string {
  const base = (params.baseUrl || '').trim().replace(/\/$/, '');
  if (!base) throw new Error('MISSING_BASE_URL');
  const relative = ensureLeadingSlash(buildSignedUploadPath({
    category: params.category,
    filename: params.filename,
    ttlSeconds: params.ttlSeconds,
  }));
  return `${base}${relative}`;
}

export function verifySignedUploadAccess(params: {
  category: string;
  filename: string;
  exp?: string | number | null;
  sig?: string | null;
}): boolean {
  const safeCategory = sanitizeUploadCategory(params.category);
  const safeFilename = sanitizeUploadFilename(params.filename);
  const sig = (params.sig || '').trim().toLowerCase();
  if (!safeCategory || !safeFilename) return false;
  if (!sig || !/^[a-f0-9]{64}$/.test(sig)) return false;

  const expRaw = typeof params.exp === 'number' ? params.exp : Number(params.exp || 0);
  const expSeconds = Math.trunc(expRaw);
  if (!Number.isFinite(expSeconds) || expSeconds <= 0) return false;

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (expSeconds <= nowSeconds) return false;
  if (expSeconds > nowSeconds + MAX_SIGNED_UPLOAD_TTL_SECONDS + 60) return false;

  const secret = resolveSigningSecret();
  if (!secret) return false;

  const expected = buildSignature(safeCategory, safeFilename, expSeconds, secret);
  const providedBuffer = Buffer.from(sig, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

export function extractWorkspaceIdFromFilename(filename: string): string | null {
  const safeFilename = sanitizeUploadFilename(filename);
  if (!safeFilename) return null;
  const match = safeFilename.match(UUID_PATTERN);
  return match ? match[0].toLowerCase() : null;
}

/**
 * Uploads Routes
 * Handles file uploads for products, etc.
 */
import { randomUUID } from 'crypto';
import { createWriteStream, existsSync, mkdirSync, promises as fs } from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { fileURLToPath } from 'url';

import { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';

import {
  DOWNLOADABLE_UPLOAD_CATEGORIES,
  buildSignedUploadPath,
  buildSignedUploadUrl,
  extractWorkspaceIdFromFilename,
  resolveSignedUploadTtlSeconds,
  sanitizeUploadCategory,
  sanitizeUploadFilename,
  verifySignedUploadAccess,
} from '../../utils/upload-access.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', '..', 'uploads');
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const INTERNAL_MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const INTERNAL_ALLOWED_CATEGORIES = new Set(['catalogs', 'orders', 'invoices', 'stock-receipts']);
const WORKSPACE_SCOPED_CATEGORIES = new Set([
  'catalogs',
  'orders',
  'invoices',
  'receipts',
  'stock-receipts',
  'whatsapp-media',
  'products',
]);

function inferContentType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.txt') return 'text/plain; charset=utf-8';
  if (ext === '.json') return 'application/json';
  return 'image/jpeg';
}

function requiredPermissionForCategory(category: string): string {
  switch (category) {
    case 'products':
      return 'products:read';
    case 'catalogs':
      return 'products:read';
    case 'orders':
      return 'orders:read';
    case 'invoices':
    case 'receipts':
      return 'payments:read';
    case 'stock-receipts':
      return 'stock:read';
    case 'whatsapp-media':
      return 'orders:read';
    default:
      return 'products:read';
  }
}

function hasPermission(permissions: string[] | undefined, permission: string): boolean {
  const granted = permissions || [];
  return granted.some((p) => {
    if (p === '*') return true;
    if (p === permission) return true;
    const [resource] = permission.split(':');
    const [grantedResource, grantedAction] = p.split(':');
    return resource === grantedResource && grantedAction === '*';
  });
}

function getMultipartFieldValue(field: unknown): string {
  if (!field) return '';
  if (Array.isArray(field)) {
    return getMultipartFieldValue(field[0]);
  }
  if (typeof field !== 'object') return '';
  if (!('value' in field)) return '';
  const value = (field as { value?: unknown }).value;
  return typeof value === 'string' ? value.trim() : '';
}

function readHeaderValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const values = value as unknown[];
    const first = values[0];
    return typeof first === 'string' ? first : '';
  }
  return '';
}

export function uploadsRoutes(app: FastifyInstance): void {
  // Ensure upload directories exist
  const productsDir = path.join(UPLOAD_DIR, 'products');
  if (!existsSync(productsDir)) {
    mkdirSync(productsDir, { recursive: true });
  }

  /**
   * GET /uploads/file/:category/:filename
   * Serve uploads via signed URL or authenticated workspace access.
   */
  app.get<{
    Params: { category: string; filename: string };
    Querystring: { exp?: string; sig?: string };
  }>('/file/:category/:filename', {
    handler: async (request, reply) => {
      const category = sanitizeUploadCategory(request.params.category);
      const filename = sanitizeUploadFilename(request.params.filename);

      if (!category || !filename || !DOWNLOADABLE_UPLOAD_CATEGORIES.has(category)) {
        return reply.status(400).send({ error: 'INVALID_FILE_REFERENCE' });
      }

      const hasValidSignature = verifySignedUploadAccess({
        category,
        filename,
        exp: request.query.exp,
        sig: request.query.sig,
      });

      if (!hasValidSignature) {
        const requiredPermission = requiredPermissionForCategory(category);
        const guard = app.requirePermission(requiredPermission);
        await guard(request, reply);
        if (reply.sent) return;

        const scopeByWorkspace = WORKSPACE_SCOPED_CATEGORIES.has(category) && !request.user?.isSuperAdmin;
        if (scopeByWorkspace) {
          const ownerWorkspaceId = extractWorkspaceIdFromFilename(filename);
          if (!ownerWorkspaceId || !request.workspaceId || ownerWorkspaceId !== request.workspaceId.toLowerCase()) {
            return reply.status(403).send({ error: 'FORBIDDEN', message: 'File does not belong to workspace' });
          }
        }
      }

      const filePath = path.join(UPLOAD_DIR, category, filename);
      if (!existsSync(filePath)) {
        return reply.status(404).send({ error: 'FILE_NOT_FOUND' });
      }

      const stat = await fs.stat(filePath);
      if (!stat.isFile()) {
        return reply.status(404).send({ error: 'FILE_NOT_FOUND' });
      }

      const buffer = await fs.readFile(filePath);
      void reply.header('Content-Type', inferContentType(filename));
      void reply.header('Content-Length', String(buffer.length));
      void reply.header('Cache-Control', hasValidSignature ? 'private, max-age=300' : 'private, no-store');
      return reply.send(buffer);
    },
  });

  /**
   * POST /uploads/product-image
   * Upload a product image
   */
  app.post('/product-image', {
    preHandler: [app.authenticate],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const workspaceId = request.workspaceId;
      if (!workspaceId) {
        return reply.status(400).send({ error: 'Workspace required' });
      }

      if (!request.user?.isSuperAdmin) {
        const permissions = (request as FastifyRequest & { permissions?: string[] }).permissions;
        const canCreateProduct = hasPermission(permissions, 'products:create');
        const canUpdateProduct = hasPermission(permissions, 'products:update');
        if (!canCreateProduct && !canUpdateProduct) {
          return reply.status(403).send({
            error: 'FORBIDDEN',
            message: "Se requiere el permiso 'products:create' o 'products:update'",
          });
        }
      }

      try {
        const data = await request.file({
          limits: { fileSize: MAX_FILE_SIZE },
        });

        if (!data) {
          return reply.status(400).send({ error: 'No file uploaded' });
        }

        // Validate file type
        if (!ALLOWED_TYPES.includes(data.mimetype)) {
          return reply.status(400).send({
            error: 'Tipo de archivo no permitido. Use JPG, PNG, WebP o GIF.',
          });
        }

        // Generate unique filename
        const ext = data.filename.split('.').pop() || 'jpg';
        const filename = `${workspaceId}-${randomUUID()}.${ext}`;
        const filepath = path.join(productsDir, filename);

        // Save file
        await pipeline(data.file, createWriteStream(filepath));

        // Return relative URL (will work with any domain)
        const imageUrl = `/uploads/products/${filename}`;

        return reply.send({
          success: true,
          url: imageUrl,
          filename,
        });
      } catch (err: unknown) {
        if (err instanceof Error && err.message.includes('size')) {
          return reply.status(400).send({
            error: 'El archivo excede el tamaño máximo de 5MB',
          });
        }
        request.log.error(err, 'Failed to upload file');
        return reply.status(500).send({ error: 'Error al subir archivo' });
      }
    },
  });

  /**
   * POST /uploads/internal-file
   * Internal upload endpoint used by worker processes running in separate containers.
   * Requires x-internal-upload-token header.
   */
  app.post('/internal-file', {
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const expectedToken = (process.env.INTERNAL_UPLOAD_TOKEN || '').trim();
      const providedToken = String(request.headers['x-internal-upload-token'] || '').trim();

      if (!expectedToken) {
        return reply.status(503).send({ error: 'INTERNAL_UPLOAD_DISABLED' });
      }

      if (!providedToken || providedToken !== expectedToken) {
        return reply.status(401).send({ error: 'UNAUTHORIZED' });
      }

      try {
        const data = await request.file({
          limits: { fileSize: INTERNAL_MAX_FILE_SIZE },
        });
        if (!data) {
          return reply.status(400).send({ error: 'NO_FILE' });
        }

        const workspaceId = getMultipartFieldValue(data.fields.workspaceId);
        if (!workspaceId) {
          return reply.status(400).send({ error: 'WORKSPACE_REQUIRED' });
        }

        const requestedCategory = (getMultipartFieldValue(data.fields.category) || 'catalogs').toLowerCase();
        const category = requestedCategory.replace(/[^a-z0-9-]/g, '') || 'catalogs';
        if (!INTERNAL_ALLOWED_CATEGORIES.has(category)) {
          return reply.status(400).send({ error: 'INVALID_CATEGORY' });
        }

        const targetDir = path.join(UPLOAD_DIR, category);
        if (!existsSync(targetDir)) {
          mkdirSync(targetDir, { recursive: true });
        }

        const originalName = (data.filename || 'archivo.bin').replace(/[^a-zA-Z0-9._-]/g, '_');
        const ext = path.extname(originalName) || '.bin';
        const baseName = path.basename(originalName, ext) || 'archivo';
        const filename = `${workspaceId}-${Date.now()}-${randomUUID().slice(0, 8)}-${baseName}${ext}`;
        const filepath = path.join(targetDir, filename);

        await pipeline(data.file, createWriteStream(filepath));

        const forwardedHost = readHeaderValue(request.headers['x-forwarded-host']);
        const host = forwardedHost || readHeaderValue(request.headers.host);
        const proto = String(request.headers['x-forwarded-proto'] || request.protocol || 'https');
        const configuredBase =
          (process.env.PUBLIC_BASE_URL || process.env.API_PUBLIC_URL || process.env.API_BASE_URL || '').trim();
        const publicBase = configuredBase || `${proto}://${host}`;

        const ttlSeconds = resolveSignedUploadTtlSeconds();
        const relativeUrl = buildSignedUploadPath({ category, filename, ttlSeconds });
        const signedUrl = buildSignedUploadUrl({
          baseUrl: publicBase.replace(/\/$/, ''),
          category,
          filename,
          ttlSeconds,
        });

        return reply.send({
          success: true,
          url: signedUrl,
          relativeUrl,
          localRef: `/uploads/${category}/${filename}`,
          expiresInSeconds: ttlSeconds,
          filename,
        });
      } catch (err: unknown) {
        if (err instanceof Error && err.message.includes('size')) {
          return reply.status(400).send({
            error: 'FILE_TOO_LARGE',
            message: 'El archivo excede el tamaño máximo permitido (25MB)',
          });
        }
        request.log.error(err, 'Failed internal file upload');
        return reply.status(500).send({ error: 'INTERNAL_UPLOAD_ERROR' });
      }
    },
  });
}

/**
 * Uploads Routes
 * Handles file uploads for products, etc.
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'crypto';
import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { pipeline } from 'stream/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', '..', 'uploads');
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const INTERNAL_MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const INTERNAL_ALLOWED_CATEGORIES = new Set(['catalogs', 'orders', 'invoices', 'stock-receipts']);

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

export async function uploadsRoutes(app: FastifyInstance): Promise<void> {
  // Ensure upload directories exist
  const productsDir = path.join(UPLOAD_DIR, 'products');
  if (!existsSync(productsDir)) {
    mkdirSync(productsDir, { recursive: true });
  }

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

        const host = request.headers['x-forwarded-host'] || request.headers.host || '';
        const proto = String(request.headers['x-forwarded-proto'] || request.protocol || 'https');
        const configuredBase =
          (process.env.PUBLIC_BASE_URL || process.env.API_PUBLIC_URL || process.env.API_BASE_URL || '').trim();
        const publicBase = configuredBase || `${proto}://${host}`;

        const relativeUrl = `/uploads/${category}/${filename}`;
        return reply.send({
          success: true,
          url: `${publicBase.replace(/\/$/, '')}${relativeUrl}`,
          relativeUrl,
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

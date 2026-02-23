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
import { resolveUploadDir, resolveUploadDirCandidates } from '../../utils/upload-dir.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOAD_DIR = resolveUploadDir(__dirname);
const UPLOAD_DIR_CANDIDATES = resolveUploadDirCandidates(__dirname);
const UPLOAD_BASE_DIRS = Array.from(new Set([UPLOAD_DIR, ...UPLOAD_DIR_CANDIDATES]));
const DB_BACKUP_CATEGORIES = new Set(['products']);
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const INTERNAL_MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const INTERNAL_ALLOWED_CATEGORIES = new Set(['catalogs', 'orders', 'statements', 'invoices', 'stock-receipts']);
const WORKSPACE_SCOPED_CATEGORIES = new Set([
  'catalogs',
  'orders',
  'statements',
  'invoices',
  'receipts',
  'stock-receipts',
  'whatsapp-media',
  'products',
]);

function resolveUploadFileCandidates(category: string, filename: string): string[] {
  return UPLOAD_BASE_DIRS.map((baseDir) => path.join(baseDir, category, filename));
}

function resolveExistingUploadFile(category: string, filename: string): { filePath: string | null; attemptedPaths: string[] } {
  const attemptedPaths = resolveUploadFileCandidates(category, filename);
  for (const candidate of attemptedPaths) {
    if (existsSync(candidate)) return { filePath: candidate, attemptedPaths };
  }
  return { filePath: null, attemptedPaths };
}

function resolveCategoryUploadDirs(category: string): string[] {
  return UPLOAD_BASE_DIRS.map((baseDir) => path.join(baseDir, category));
}

async function mirrorUploadFileAcrossCandidates(
  category: string,
  filename: string,
  sourcePath: string,
  log: FastifyRequest['log']
): Promise<void> {
  const sourceDir = path.resolve(path.dirname(sourcePath));
  const candidateDirs = Array.from(new Set(resolveCategoryUploadDirs(category).map((dir) => path.resolve(dir))));

  await Promise.all(candidateDirs.map(async (targetDir) => {
    if (targetDir === sourceDir) return;

    const targetPath = path.join(targetDir, filename);
    try {
      await fs.mkdir(targetDir, { recursive: true });
      await fs.copyFile(sourcePath, targetPath);
    } catch (error) {
      log.warn(
        {
          category,
          filename,
          sourcePath,
          targetPath,
          error,
        },
        'Could not mirror uploaded file into candidate upload directory'
      );
    }
  }));
}

async function mirrorUploadBufferAcrossCandidates(
  category: string,
  filename: string,
  buffer: Buffer,
  log: FastifyRequest['log']
): Promise<void> {
  const candidatePaths = resolveUploadFileCandidates(category, filename);
  await Promise.all(candidatePaths.map(async (targetPath) => {
    try {
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, buffer);
    } catch (error) {
      log.warn(
        {
          category,
          filename,
          targetPath,
          error,
        },
        'Could not hydrate upload buffer into candidate path'
      );
    }
  }));
}

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
    case 'statements':
      return 'payments:read';
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

export async function uploadsRoutes(app: FastifyInstance): Promise<void> {
  // Ensure upload directories exist
  const productUploadDirs = resolveCategoryUploadDirs('products');
  const primaryProductsDir = productUploadDirs[0] || path.join(UPLOAD_DIR, 'products');
  if (!existsSync(primaryProductsDir)) {
    mkdirSync(primaryProductsDir, { recursive: true });
  }

  let dbBackupsAvailable = false;
  try {
    await app.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS upload_file_backups (
        category VARCHAR(64) NOT NULL,
        filename VARCHAR(255) NOT NULL,
        mime_type VARCHAR(255) NOT NULL,
        content BYTEA NOT NULL,
        size_bytes INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (category, filename)
      )
    `);
    dbBackupsAvailable = true;
  } catch (error) {
    app.log.warn({ error }, 'Could not ensure upload_file_backups table');
  }

  const persistUploadBackup = async (
    category: string,
    filename: string,
    mimeType: string,
    content: Buffer
  ): Promise<void> => {
    if (!dbBackupsAvailable || !DB_BACKUP_CATEGORIES.has(category)) return;
    try {
      await app.prisma.$executeRaw`
        INSERT INTO upload_file_backups (category, filename, mime_type, content, size_bytes, updated_at)
        VALUES (${category}, ${filename}, ${mimeType}, ${content}, ${content.length}, NOW())
        ON CONFLICT (category, filename)
        DO UPDATE SET
          mime_type = EXCLUDED.mime_type,
          content = EXCLUDED.content,
          size_bytes = EXCLUDED.size_bytes,
          updated_at = NOW()
      `;
    } catch (error) {
      app.log.warn(
        {
          category,
          filename,
          error,
        },
        'Could not persist upload backup into database'
      );
    }
  };

  const readUploadBackup = async (
    category: string,
    filename: string
  ): Promise<{ mimeType: string; content: Buffer } | null> => {
    if (!dbBackupsAvailable || !DB_BACKUP_CATEGORIES.has(category)) return null;
    try {
      const rows = await app.prisma.$queryRaw<Array<{ mime_type: string; content: Buffer }>>`
        SELECT mime_type, content
        FROM upload_file_backups
        WHERE category = ${category}
          AND filename = ${filename}
        LIMIT 1
      `;
      if (!rows.length || !rows[0]?.content) return null;
      return {
        mimeType: rows[0].mime_type || inferContentType(filename),
        content: rows[0].content,
      };
    } catch (error) {
      app.log.warn(
        {
          category,
          filename,
          error,
        },
        'Could not read upload backup from database'
      );
      return null;
    }
  };

  /**
   * GET /uploads/file/:category/:filename
   * Serve uploads via signed URL or authenticated workspace access.
   */
  app.get<{
    Params: { category: string; filename: string };
    Querystring: { exp?: string; sig?: string };
  }>('/file/:category/:filename', {
    config: {
      allowMissingWorkspace: true,
    },
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
        await app.authenticate(request, reply);
        if (reply.sent) return;

        if (!request.user) {
          return reply.status(401).send({ error: 'UNAUTHORIZED' });
        }

        if (!request.user.isSuperAdmin) {
          const scopeByWorkspace = WORKSPACE_SCOPED_CATEGORIES.has(category);
          if (scopeByWorkspace) {
            const ownerWorkspaceId = extractWorkspaceIdFromFilename(filename);
            if (!ownerWorkspaceId) {
              return reply.status(403).send({ error: 'FORBIDDEN', message: 'File does not belong to workspace' });
            }

            const membership = await app.prisma.membership.findUnique({
              where: {
                userId_workspaceId: {
                  userId: request.user.sub,
                  workspaceId: ownerWorkspaceId,
                },
              },
              include: {
                role: {
                  select: {
                    permissions: true,
                  },
                },
              },
            });
            const membershipStatus = (membership?.status || '').toLowerCase();
            if (!membership || membershipStatus !== 'active') {
              return reply.status(403).send({ error: 'FORBIDDEN', message: 'File does not belong to workspace' });
            }

            if (!hasPermission(membership.role.permissions, requiredPermission)) {
              return reply.status(403).send({
                error: 'FORBIDDEN',
                message: `Se requiere el permiso '${requiredPermission}'`,
              });
            }
          } else {
            const guard = app.requirePermission(requiredPermission);
            await guard(request, reply);
            if (reply.sent) return;
          }
        }
      }

      const { filePath, attemptedPaths } = resolveExistingUploadFile(category, filename);
      if (!filePath) {
        const backup = await readUploadBackup(category, filename);
        if (backup) {
          await mirrorUploadBufferAcrossCandidates(category, filename, backup.content, request.log);
          void reply.header('Content-Type', backup.mimeType);
          void reply.header('Content-Length', String(backup.content.length));
          void reply.header('Cache-Control', hasValidSignature ? 'private, max-age=300' : 'private, no-store');
          return reply.send(backup.content);
        }

        request.log.warn(
          {
            category,
            filename,
            attemptedPaths,
          },
          'Upload file was not found in any candidate directory'
        );
        return reply.status(404).send({ error: 'FILE_NOT_FOUND' });
      }

      const stat = await fs.stat(filePath);
      if (!stat.isFile()) {
        return reply.status(404).send({ error: 'FILE_NOT_FOUND' });
      }

      const buffer = await fs.readFile(filePath);
      await persistUploadBackup(category, filename, inferContentType(filename), buffer);
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
        const canManageCustomers = hasPermission(permissions, 'customers:update');
        if (!canCreateProduct && !canUpdateProduct && !canManageCustomers) {
          return reply.status(403).send({
            error: 'FORBIDDEN',
            message: "Se requiere el permiso 'products:create', 'products:update' o 'customers:update'",
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
        const filepath = path.join(primaryProductsDir, filename);

        // Save file
        await pipeline(data.file, createWriteStream(filepath));
        await mirrorUploadFileAcrossCandidates('products', filename, filepath, request.log);
        const storedBuffer = await fs.readFile(filepath);
        await persistUploadBackup('products', filename, data.mimetype, storedBuffer);

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

        const categoryUploadDirs = resolveCategoryUploadDirs(category);
        const targetDir = categoryUploadDirs[0] || path.join(UPLOAD_DIR, category);
        if (!existsSync(targetDir)) {
          mkdirSync(targetDir, { recursive: true });
        }

        const originalName = (data.filename || 'archivo.bin').replace(/[^a-zA-Z0-9._-]/g, '_');
        const ext = path.extname(originalName) || '.bin';
        const baseName = path.basename(originalName, ext) || 'archivo';
        const filename = `${workspaceId}-${Date.now()}-${randomUUID().slice(0, 8)}-${baseName}${ext}`;
        const filepath = path.join(targetDir, filename);

        await pipeline(data.file, createWriteStream(filepath));
        await mirrorUploadFileAcrossCandidates(category, filename, filepath, request.log);

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

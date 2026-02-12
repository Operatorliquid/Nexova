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
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

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
}

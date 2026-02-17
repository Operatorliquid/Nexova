import { promises as fs, existsSync } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { FileUploader } from '../tools/retail/catalog.tools.js';

type UploadOptions = {
  category?: string;
};

export class LocalFileUploader implements FileUploader {
  async upload(
    buffer: Buffer,
    filename: string,
    mimeType: string,
    workspaceId: string,
    options?: UploadOptions
  ): Promise<string> {
    const safeName = this.sanitizeFilename(filename || 'archivo.pdf');
    const category = this.sanitizeCategory(options?.category || 'catalogs');

    const uploadedViaApi = await this.tryUploadThroughApi(
      buffer,
      safeName,
      mimeType,
      workspaceId,
      category
    );
    if (uploadedViaApi) {
      return uploadedViaApi;
    }

    const uploadDir = this.getUploadDir();
    const targetDir = path.join(uploadDir, category);
    await fs.mkdir(targetDir, { recursive: true });

    const uniqueName = `${workspaceId}-${Date.now()}-${randomUUID().slice(0, 8)}-${safeName}`;
    const filePath = path.join(targetDir, uniqueName);

    await fs.writeFile(filePath, buffer);

    const publicBase = await this.resolvePublicBaseUrl();
    if (!publicBase) {
      throw new Error('No hay una URL pública configurada para enviar el PDF.');
    }

    return `${publicBase}/uploads/${category}/${uniqueName}`;
  }

  private sanitizeCategory(category: string): string {
    const normalized = (category || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (!normalized) return 'catalogs';
    return normalized;
  }

  private async tryUploadThroughApi(
    buffer: Buffer,
    filename: string,
    mimeType: string,
    workspaceId: string,
    category: string
  ): Promise<string | null> {
    const token = (process.env.INTERNAL_UPLOAD_TOKEN || '').trim();
    if (!token) {
      return null;
    }

    const uploadUrl = await this.resolveInternalUploadUrl();
    if (!uploadUrl) {
      return null;
    }

    try {
      const form = new FormData();
      form.append('workspaceId', workspaceId);
      form.append('category', category);
      form.append(
        'file',
        new Blob([buffer], { type: mimeType || 'application/octet-stream' }),
        filename
      );

      const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          'x-internal-upload-token': token,
        },
        body: form,
        signal: AbortSignal.timeout(20000),
      });

      const bodyText = await response.text();
      const payload = bodyText ? (this.safeJsonParse(bodyText) as Record<string, unknown> | null) : null;

      if (!response.ok) {
        throw new Error(
          `Internal upload failed (${response.status}): ${payload?.error || bodyText || 'unknown_error'}`
        );
      }

      const relativeUrl = payload?.relativeUrl;
      if (typeof relativeUrl === 'string' && relativeUrl.trim()) {
        const publicBase = await this.resolvePublicBaseUrl();
        if (publicBase) {
          return `${publicBase}${relativeUrl.startsWith('/') ? '' : '/'}${relativeUrl}`;
        }
      }

      const rawUrl = payload?.url;
      if (typeof rawUrl === 'string' && rawUrl.trim()) {
        // When API responds with an internal/private host URL, prefer rebuilding
        // with our configured public base to ensure WhatsApp providers can fetch it.
        const publicBase = await this.resolvePublicBaseUrl();
        if (publicBase) {
          try {
            const parsed = new URL(rawUrl);
            if (parsed.pathname.startsWith('/uploads/')) {
              return `${publicBase}${parsed.pathname}${parsed.search || ''}`;
            }
          } catch {
            // Keep raw URL fallback below.
          }
        }
        return rawUrl;
      }

      return null;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`[LocalFileUploader] Internal upload failed, using local fallback: ${msg}`);
      return null;
    }
  }

  private async resolveInternalUploadUrl(): Promise<string | null> {
    const explicit = (process.env.INTERNAL_UPLOAD_URL || '').trim();
    if (explicit) {
      return explicit;
    }

    const apiInternalBase = (process.env.API_INTERNAL_URL || '').trim();
    if (apiInternalBase) {
      return `${apiInternalBase.replace(/\/$/, '')}/api/v1/uploads/internal-file`;
    }

    const publicBase = await this.resolvePublicBaseUrl();
    if (!publicBase) {
      return null;
    }
    return `${publicBase}/api/v1/uploads/internal-file`;
  }

  private sanitizeFilename(name: string): string {
    return name.replace(/[^a-zA-Z0-9._-]/g, '_');
  }

  private getUploadDir(): string {
    if (process.env.UPLOAD_DIR) {
      return process.env.UPLOAD_DIR;
    }

    const repoRoot = this.findRepoRoot(process.cwd()) || process.cwd();
    return path.join(repoRoot, 'apps', 'api', 'uploads');
  }

  private async resolvePublicBaseUrl(): Promise<string | null> {
    const candidates = [
      process.env.API_BASE_URL,
      process.env.PUBLIC_BASE_URL,
      process.env.PUBLIC_API_URL,
      process.env.API_PUBLIC_URL,
      process.env.NGROK_URL,
      process.env.BASE_URL,
      process.env.API_URL,
    ];

    for (const candidate of candidates) {
      if (candidate && candidate.trim()) {
        return candidate.replace(/\/$/, '');
      }
    }

    return this.resolveNgrokBaseUrl();
  }

  private async resolveNgrokBaseUrl(): Promise<string | null> {
    try {
      const response = await fetch('http://127.0.0.1:4040/api/tunnels', {
        signal: AbortSignal.timeout(1500),
      });
      if (!response.ok) return null;
      const data = await response.json() as { tunnels?: Array<{ public_url?: string }> };
      const httpsTunnel = data.tunnels?.find((t) => t.public_url?.startsWith('https://'));
      return httpsTunnel?.public_url?.replace(/\/$/, '') || null;
    } catch {
      return null;
    }
  }

  private findRepoRoot(startDir: string): string | null {
    let current = startDir;
    for (let i = 0; i < 8; i += 1) {
      if (
        existsSync(path.join(current, 'pnpm-workspace.yaml')) ||
        existsSync(path.join(current, 'turbo.json'))
      ) {
        return current;
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return null;
  }

  private safeJsonParse(text: string): unknown | null {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
}

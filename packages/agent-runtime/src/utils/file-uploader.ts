import { promises as fs, existsSync } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { FileUploader } from '../tools/retail/catalog.tools.js';

export class LocalFileUploader implements FileUploader {
  async upload(
    buffer: Buffer,
    filename: string,
    _mimeType: string,
    workspaceId: string
  ): Promise<string> {
    const uploadDir = this.getUploadDir();
    const catalogsDir = path.join(uploadDir, 'catalogs');
    await fs.mkdir(catalogsDir, { recursive: true });

    const safeName = this.sanitizeFilename(filename || 'catalogo.pdf');
    const uniqueName = `${workspaceId}-${Date.now()}-${randomUUID().slice(0, 8)}-${safeName}`;
    const filePath = path.join(catalogsDir, uniqueName);

    await fs.writeFile(filePath, buffer);

    const publicBase = await this.resolvePublicBaseUrl();
    if (!publicBase) {
      throw new Error('No hay una URL pública configurada para enviar el PDF.');
    }

    return `${publicBase}/uploads/catalogs/${uniqueName}`;
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
}

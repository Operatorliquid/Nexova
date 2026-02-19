import { lookup } from 'dns/promises';
import { isIP } from 'net';

type HostMatcher = (hostname: string) => boolean;

function normalizeIpv4(ip: string): number[] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => Number.parseInt(p, 10));
  if (nums.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return null;
  return nums;
}

function isPrivateIpv4(ip: string): boolean {
  const nums = normalizeIpv4(ip);
  if (!nums) return true;
  const [a, b] = nums;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 0) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateIpv6(rawIp: string): boolean {
  const ip = rawIp.toLowerCase().split('%')[0];
  if (ip === '::1' || ip === '::') return true;
  if (ip.startsWith('fc') || ip.startsWith('fd')) return true;
  if (ip.startsWith('fe8') || ip.startsWith('fe9') || ip.startsWith('fea') || ip.startsWith('feb')) return true;
  if (ip.startsWith('::ffff:')) {
    return isPrivateIpv4(ip.slice('::ffff:'.length));
  }
  return false;
}

function isPrivateIp(ip: string): boolean {
  const ipVersion = isIP(ip);
  if (ipVersion === 4) return isPrivateIpv4(ip);
  if (ipVersion === 6) return isPrivateIpv6(ip);
  return true;
}

function normalizeContentType(value: string | null): string {
  return (value || '').split(';')[0]?.trim().toLowerCase() || '';
}

function matchesContentType(contentType: string, allowed: string[]): boolean {
  if (!contentType || allowed.length === 0) return false;
  return allowed.some((rule) => {
    const normalizedRule = rule.toLowerCase().trim();
    if (!normalizedRule) return false;
    if (normalizedRule.endsWith('/*')) {
      const prefix = normalizedRule.slice(0, normalizedRule.length - 1);
      return contentType.startsWith(prefix);
    }
    return contentType === normalizedRule;
  });
}

export async function assertRemoteUrlSafe(
  urlValue: string,
  options: { isAllowedHost: HostMatcher; allowHttp?: boolean }
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    throw new Error('URL remota invalida');
  }

  const protocol = url.protocol.toLowerCase();
  const allowHttp = options.allowHttp === true;
  if (protocol !== 'https:' && (!allowHttp || protocol !== 'http:')) {
    throw new Error('Solo se permiten URLs HTTPS');
  }

  const hostname = url.hostname.toLowerCase();
  if (!options.isAllowedHost(hostname)) {
    throw new Error('Host remoto no permitido');
  }

  if (isIP(hostname) && isPrivateIp(hostname)) {
    throw new Error('IP privada bloqueada');
  }

  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length) {
    throw new Error('No se pudieron resolver IPs del host remoto');
  }

  for (const entry of addresses) {
    if (isPrivateIp(entry.address)) {
      throw new Error('Host remoto resuelve a IP privada');
    }
  }

  return url;
}

export async function fetchBinaryWithGuards(params: {
  url: string;
  headers?: Record<string, string>;
  isAllowedHost: HostMatcher;
  allowedContentTypes: string[];
  maxBytes: number;
  timeoutMs?: number;
  allowHttp?: boolean;
}): Promise<{ buffer: Buffer; contentType: string }> {
  const timeoutMs = params.timeoutMs && params.timeoutMs > 0 ? params.timeoutMs : 15000;
  const maxBytes = Number.isFinite(params.maxBytes) ? Math.max(1, Math.trunc(params.maxBytes)) : 8 * 1024 * 1024;

  const safeUrl = await assertRemoteUrlSafe(params.url, {
    isAllowedHost: params.isAllowedHost,
    allowHttp: params.allowHttp,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(safeUrl.toString(), {
      headers: params.headers || {},
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`No pude descargar el archivo remoto (HTTP ${response.status})`);
    }

    const contentType = normalizeContentType(response.headers.get('content-type'));
    if (!matchesContentType(contentType, params.allowedContentTypes)) {
      throw new Error(`Tipo de archivo no permitido: ${contentType || 'desconocido'}`);
    }

    const declaredLength = Number.parseInt(response.headers.get('content-length') || '0', 10);
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      throw new Error('El archivo remoto excede el tamaño máximo permitido');
    }

    if (!response.body) throw new Error('Respuesta remota sin contenido');
    const payload = new Uint8Array(await response.arrayBuffer());
    if (payload.byteLength > maxBytes) {
      throw new Error('El archivo remoto excede el tamaño máximo permitido');
    }

    return {
      buffer: Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength),
      contentType,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.toLowerCase().includes('abort')) {
      throw new Error('Timeout al descargar el archivo remoto');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

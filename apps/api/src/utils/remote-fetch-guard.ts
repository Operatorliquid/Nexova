import { lookup } from 'dns/promises';
import { isIP } from 'net';

type HostMatcher = (hostname: string) => boolean;

export class RemoteFetchError extends Error {
  code: string;
  statusCode: number;
  details?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    statusCode = 400,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'RemoteFetchError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

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
  if (ip.startsWith('fe8') || ip.startsWith('fe9') || ip.startsWith('fea') || ip.startsWith('feb')) {
    return true;
  }
  if (ip.startsWith('::ffff:')) {
    const ipv4Part = ip.slice('::ffff:'.length);
    return isPrivateIpv4(ipv4Part);
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

export async function assertRemoteUrlAllowed(
  urlValue: string,
  options: {
    isAllowedHost: HostMatcher;
    allowHttp?: boolean;
  }
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    throw new RemoteFetchError('INVALID_URL', 'Invalid remote URL');
  }

  const protocol = url.protocol.toLowerCase();
  const allowHttp = options.allowHttp === true;
  if (protocol !== 'https:' && (!allowHttp || protocol !== 'http:')) {
    throw new RemoteFetchError('INVALID_PROTOCOL', 'Only HTTPS URLs are allowed');
  }

  const hostname = url.hostname.toLowerCase();
  if (!options.isAllowedHost(hostname)) {
    throw new RemoteFetchError('HOST_NOT_ALLOWED', 'Remote host is not allowed');
  }

  if (isIP(hostname) && isPrivateIp(hostname)) {
    throw new RemoteFetchError('PRIVATE_IP_BLOCKED', 'Private IPs are not allowed');
  }

  let addresses: Array<{ address: string }> = [];
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new RemoteFetchError('DNS_LOOKUP_FAILED', 'Failed to resolve remote host');
  }

  if (!addresses.length) {
    throw new RemoteFetchError('DNS_LOOKUP_FAILED', 'Remote host resolved without addresses');
  }

  for (const entry of addresses) {
    if (isPrivateIp(entry.address)) {
      throw new RemoteFetchError('PRIVATE_IP_BLOCKED', 'Remote host resolves to private IP');
    }
  }

  return url;
}

export async function fetchRemoteBinarySafely(params: {
  url: string;
  headers?: Record<string, string>;
  isAllowedHost: HostMatcher;
  allowedContentTypes: string[];
  maxBytes: number;
  timeoutMs?: number;
  allowHttp?: boolean;
}): Promise<{ buffer: Buffer; contentType: string }> {
  const timeoutMs = params.timeoutMs && params.timeoutMs > 0 ? params.timeoutMs : 15000;
  const maxBytes = Number.isFinite(params.maxBytes) ? Math.max(1, Math.trunc(params.maxBytes)) : 5 * 1024 * 1024;

  const safeUrl = await assertRemoteUrlAllowed(params.url, {
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
      const bodySnippet = await response.text().catch(() => '');
      throw new RemoteFetchError(
        'UPSTREAM_ERROR',
        bodySnippet || `Remote server responded ${response.status}`,
        502,
        { status: response.status }
      );
    }

    const contentType = normalizeContentType(response.headers.get('content-type'));
    if (!matchesContentType(contentType, params.allowedContentTypes)) {
      throw new RemoteFetchError(
        'UNSUPPORTED_CONTENT_TYPE',
        `Unsupported content type: ${contentType || 'unknown'}`,
        415
      );
    }

    const declaredLength = Number.parseInt(response.headers.get('content-length') || '0', 10);
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      throw new RemoteFetchError('PAYLOAD_TOO_LARGE', 'Remote file exceeds size limit', 413);
    }

    if (!response.body) {
      throw new RemoteFetchError('EMPTY_BODY', 'Remote response has no body', 502);
    }
    const payload = new Uint8Array(await response.arrayBuffer());
    if (payload.byteLength > maxBytes) {
      throw new RemoteFetchError('PAYLOAD_TOO_LARGE', 'Remote file exceeds size limit', 413);
    }

    return {
      buffer: Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength),
      contentType,
    };
  } catch (error) {
    if (error instanceof RemoteFetchError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes('abort')) {
      throw new RemoteFetchError('FETCH_TIMEOUT', 'Remote fetch timeout', 504);
    }
    throw new RemoteFetchError('FETCH_FAILED', message || 'Remote fetch failed', 502);
  } finally {
    clearTimeout(timeout);
  }
}

import { lookup } from 'dns/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('dns/promises', () => ({
  lookup: vi.fn(),
}));

import { assertRemoteUrlSafe, fetchBinaryWithGuards } from '../../src/utils/remote-fetch-guard.js';

const PUBLIC_IP = '93.184.216.34';
const fetchMock = vi.fn<typeof fetch>();

function makeChunkedResponse(contentType: string, chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { 'content-type': contentType },
  });
}

describe('remote-fetch-guard (worker)', () => {
  beforeEach(() => {
    vi.mocked(lookup).mockReset();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects URLs from non-allowed hosts before DNS lookup', async () => {
    await expect(
      assertRemoteUrlSafe('https://blocked.example.com/audio.ogg', {
        isAllowedHost: () => false,
      })
    ).rejects.toThrow('Host remoto no permitido');
    expect(lookup).not.toHaveBeenCalled();
  });

  it('rejects hosts that resolve to private IPs', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);

    await expect(
      assertRemoteUrlSafe('https://allowed.example.com/audio.ogg', {
        isAllowedHost: () => true,
      })
    ).rejects.toThrow('Host remoto resuelve a IP privada');
  });

  it('enforces strict content-type validation', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: PUBLIC_IP, family: 4 }]);
    fetchMock.mockResolvedValue(
      new Response('not-audio', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      })
    );

    await expect(
      fetchBinaryWithGuards({
        url: 'https://allowed.example.com/audio.ogg',
        isAllowedHost: () => true,
        allowedContentTypes: ['audio/*'],
        maxBytes: 1024,
      })
    ).rejects.toThrow('Unsupported media content-type');
  });

  it('rejects payloads that exceed maxBytes while streaming', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: PUBLIC_IP, family: 4 }]);
    fetchMock.mockResolvedValue(makeChunkedResponse('audio/ogg', ['abc', 'de']));

    await expect(
      fetchBinaryWithGuards({
        url: 'https://allowed.example.com/audio.ogg',
        isAllowedHost: () => true,
        allowedContentTypes: ['audio/*'],
        maxBytes: 4,
      })
    ).rejects.toThrow('Audio file too large');
  });
});

import { lookup } from 'dns/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('dns/promises', () => ({
  lookup: vi.fn(),
}));

import {
  RemoteFetchError,
  assertRemoteUrlAllowed,
  fetchRemoteBinarySafely,
} from '../../src/utils/remote-fetch-guard.js';

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

describe('remote-fetch-guard (api)', () => {
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
      assertRemoteUrlAllowed('https://blocked.example.com/file.pdf', {
        isAllowedHost: () => false,
      })
    ).rejects.toMatchObject({ code: 'HOST_NOT_ALLOWED' });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('rejects hosts that resolve to private IPs', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);

    await expect(
      assertRemoteUrlAllowed('https://allowed.example.com/file.pdf', {
        isAllowedHost: () => true,
      })
    ).rejects.toMatchObject({ code: 'PRIVATE_IP_BLOCKED' });
  });

  it('enforces strict content-type validation', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: PUBLIC_IP, family: 4 }]);
    fetchMock.mockResolvedValue(
      new Response('hello', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      })
    );

    await expect(
      fetchRemoteBinarySafely({
        url: 'https://allowed.example.com/file.pdf',
        isAllowedHost: () => true,
        allowedContentTypes: ['application/pdf'],
        maxBytes: 1024,
      })
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT_TYPE' });
  });

  it('rejects payloads that exceed maxBytes while streaming', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: PUBLIC_IP, family: 4 }]);
    fetchMock.mockResolvedValue(makeChunkedResponse('application/pdf', ['abc', 'de']));

    const resultPromise = fetchRemoteBinarySafely({
      url: 'https://allowed.example.com/file.pdf',
      isAllowedHost: () => true,
      allowedContentTypes: ['application/pdf'],
      maxBytes: 4,
    });

    await expect(resultPromise).rejects.toBeInstanceOf(RemoteFetchError);
    await expect(resultPromise).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  });
});

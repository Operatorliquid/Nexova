import { describe, expect, it } from 'vitest';
import {
  extractAudioTranscriptFromPayload,
  isAwaitingAudioTranscriptionPayload,
} from '../../src/worker/payload-audio.utils.js';

describe('payload-audio.utils', () => {
  it('extracts transcript from __nexova.audio and trims spaces', () => {
    const payload = {
      __nexova: {
        audio: {
          transcript: '  hola mundo  ',
        },
      },
    };

    expect(extractAudioTranscriptFromPayload(payload)).toBe('hola mundo');
  });

  it('returns null transcript when payload has no audio metadata', () => {
    expect(extractAudioTranscriptFromPayload({})).toBeNull();
    expect(extractAudioTranscriptFromPayload(null)).toBeNull();
    expect(extractAudioTranscriptFromPayload(undefined)).toBeNull();
  });

  it('marks payload as awaiting transcription when audio exists without transcript/block reason', () => {
    const payload = {
      __nexova: {
        audio: {
          provider: 'evolution',
          messageId: 'abc-123',
        },
      },
    };

    expect(isAwaitingAudioTranscriptionPayload(payload)).toBe(true);
  });

  it('does not mark as awaiting when transcript already exists', () => {
    const payload = {
      __nexova: {
        audio: {
          messageId: 'abc-123',
          transcript: 'texto final',
        },
      },
    };

    expect(isAwaitingAudioTranscriptionPayload(payload)).toBe(false);
  });

  it('does not mark as awaiting when audio is blocked by policy', () => {
    const payload = {
      __nexova: {
        audio: {
          messageId: 'abc-123',
          blockedReason: 'monthly_quota_exceeded',
        },
      },
    };

    expect(isAwaitingAudioTranscriptionPayload(payload)).toBe(false);
  });
});


type AnyObject = Record<string, unknown>;

function asObject(value: unknown): AnyObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as AnyObject;
}

export function extractAudioTranscriptFromPayload(payload: unknown): string | null {
  const root = asObject(payload);
  const nexova = asObject(root.__nexova);
  const audio = asObject(nexova.audio);
  const transcript = typeof audio.transcript === 'string' ? audio.transcript.trim() : '';
  return transcript || null;
}

export function isAwaitingAudioTranscriptionPayload(payload: unknown): boolean {
  const root = asObject(payload);
  const nexova = asObject(root.__nexova);
  const audio = asObject(nexova.audio);
  if (Object.keys(audio).length === 0) return false;

  const transcript = extractAudioTranscriptFromPayload(payload);
  if (transcript) return false;

  const blockedReason = typeof audio.blockedReason === 'string' ? audio.blockedReason.trim() : '';
  if (blockedReason) return false;

  return true;
}


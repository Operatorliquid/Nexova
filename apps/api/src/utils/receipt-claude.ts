import Anthropic from '@anthropic-ai/sdk';

const INT32_MAX = 2_147_483_647;

function parseAmountToCents(raw: string): number | null {
  let value = raw.trim();
  if (!value) return null;

  if (value.includes('.') && value.includes(',')) {
    value = value.replace(/\./g, '').replace(',', '.');
  } else if (value.includes(',')) {
    const parts = value.split(',');
    if (parts[1] && parts[1].length === 2) {
      value = `${parts[0].replace(/\./g, '')}.${parts[1]}`;
    } else {
      value = value.replace(/,/g, '');
    }
  } else {
    value = value.replace(/,/g, '');
  }

  const amount = Number(value);
  if (Number.isNaN(amount) || amount <= 0) return null;
  const cents = Math.round(amount * 100);
  if (cents <= 0 || cents > INT32_MAX) return null;
  return cents;
}

export function parseAmountInputToCents(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = parseAmountToCents(value);
  if (!parsed) return undefined;
  return parsed;
}

type ReceiptExtractResult = {
  amountCents?: number;
  confidence?: number;
  extractedText?: string;
};

function buildPrompt(expectedAmount?: number): string {
  const expected = expectedAmount
    ? `Monto esperado: ${expectedAmount} centavos (ARS).`
    : 'Monto esperado: desconocido.';

  return [
    'Extrae el MONTO TOTAL PAGADO de este comprobante.',
    'Si hay varias cifras, priorizá el total final o el monto más cercano al esperado.',
    'Respondé en centavos (ARS). Ejemplo: si el total es $20.000, respondé 2000000.',
    expected,
    'Respondé SOLO con JSON válido en una sola línea:',
    '{"amount_cents": number | null, "confidence": number (0-1)}',
  ].join('\n');
}

function normalizeAmount(value: unknown, expectedAmount?: number): number | undefined {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return undefined;
    let cents = Math.round(value);
    if (cents <= 0 || cents > INT32_MAX) return undefined;
    if (
      expectedAmount &&
      expectedAmount > 0 &&
      cents < expectedAmount * 0.2 &&
      cents * 100 <= INT32_MAX &&
      Math.abs(cents * 100 - expectedAmount) < Math.abs(cents - expectedAmount)
    ) {
      cents = cents * 100;
    }
    return cents;
  }
  if (typeof value === 'string') {
    const parsed = parseAmountToCents(value);
    if (!parsed) return undefined;
    return normalizeAmount(parsed, expectedAmount);
  }
  return undefined;
}

export async function extractReceiptAmountWithClaude(params: {
  buffer: Buffer;
  mediaType: string;
  expectedAmount?: number;
}): Promise<ReceiptExtractResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY || '';
  if (!apiKey) return {};

  const model = process.env.RECEIPT_OCR_MODEL || process.env.LLM_MODEL || 'claude-sonnet-4-20250514';
  const anthropic = new Anthropic({ apiKey });

  const base64 = params.buffer.toString('base64');
  const content: Anthropic.ContentBlockParam[] = [{ type: 'text', text: buildPrompt(params.expectedAmount) }];

  if (params.mediaType === 'application/pdf') {
    content.push({
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: base64,
      },
    } as Anthropic.ContentBlockParam);
  } else {
    const mediaType = params.mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: mediaType,
        data: base64,
      },
    } as Anthropic.ContentBlockParam);
  }

  const response = await anthropic.messages.create({
    model,
    max_tokens: 200,
    temperature: 0,
    messages: [{ role: 'user', content }],
  });

  const textBlock = response.content.find((block) => block.type === 'text');
  const rawText = textBlock?.text?.trim() || '';
  if (!rawText) return {};

  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { extractedText: rawText };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as { amount_cents?: unknown; confidence?: unknown };
    const amount = normalizeAmount(parsed.amount_cents, params.expectedAmount);
    const confidence =
      typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence)
        ? Math.max(0, Math.min(1, parsed.confidence))
        : undefined;

    return {
      amountCents: amount,
      confidence,
      extractedText: rawText,
    };
  } catch {
    return { extractedText: rawText };
  }
}

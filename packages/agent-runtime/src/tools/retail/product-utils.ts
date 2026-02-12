export const UNIT_SHORT_LABELS: Record<string, string> = {
  unit: 'uds',
  kg: 'kg',
  g: 'g',
  l: 'lts',
  ml: 'ml',
  m: 'm',
  cm: 'cm',
  pack: 'pack',
  dozen: 'doc',
  box: 'caja',
};

export const SECONDARY_UNIT_LABELS: Record<string, string> = {
  pack: 'Pack',
  box: 'Caja',
  bundle: 'Bulto',
  dozen: 'Docena',
};

const UNIT_SYNONYMS: Record<string, string> = {
  unit: 'unit',
  ud: 'unit',
  uds: 'unit',
  unidad: 'unit',
  unidades: 'unit',
  pack: 'pack',
  paquete: 'pack',
  paquetes: 'pack',
  box: 'box',
  caja: 'box',
  cajas: 'box',
  bulto: 'bundle',
  bultos: 'bundle',
  dozen: 'dozen',
  docena: 'dozen',
  docenas: 'dozen',
  doc: 'dozen',
  kg: 'kg',
  kilo: 'kg',
  kilos: 'kg',
  kilogramo: 'kg',
  kilogramos: 'kg',
  g: 'g',
  gramo: 'g',
  gramos: 'g',
  l: 'l',
  lt: 'l',
  lts: 'l',
  litro: 'l',
  litros: 'l',
  ml: 'ml',
  mililitro: 'ml',
  mililitros: 'ml',
  m: 'm',
  metro: 'm',
  metros: 'm',
  cm: 'cm',
  centimetro: 'cm',
  centimetros: 'cm',
};

const BASE_UNIT_FACTORS: Record<string, { base: string; factor: number }> = {
  l: { base: 'ml', factor: 1000 },
  ml: { base: 'ml', factor: 1 },
  kg: { base: 'g', factor: 1000 },
  g: { base: 'g', factor: 1 },
  m: { base: 'cm', factor: 100 },
  cm: { base: 'cm', factor: 1 },
};

const normalizeNumber = (value?: string | number | null): number | null => {
  if (value === null || value === undefined) return null;
  const raw = typeof value === 'number' ? value.toString() : value.toString();
  const normalized = raw.replace(',', '.').trim();
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const collapseDuplicates = (value: string) => value.replace(/(.)\1+/g, '$1');

export const normalizeUnitToken = (token: string): string | null => {
  const cleaned = token
    .toLowerCase()
    .replace(/[^a-z]/g, '')
    .trim();
  if (!cleaned) return null;

  let normalized = collapseDuplicates(cleaned);

  if (normalized.endsWith('s') && normalized.length > 1) {
    normalized = normalized.slice(0, -1);
  }

  if (UNIT_SYNONYMS[normalized]) {
    return UNIT_SYNONYMS[normalized];
  }

  // Fallback: map by prefixes to handle typos (e.g., lttss, kgg, mtrs)
  if (normalized.startsWith('lt')) return 'l';
  if (normalized.startsWith('lit')) return 'l';
  if (normalized.startsWith('ml')) return 'ml';
  if (normalized.startsWith('kilo') || normalized.startsWith('kg') || normalized.startsWith('kilog')) return 'kg';
  if (normalized.startsWith('gr')) return 'g';
  if (normalized.startsWith('mt') || normalized.startsWith('mtr') || normalized.startsWith('metr')) return 'm';
  if (normalized.startsWith('cm') || normalized.startsWith('cent')) return 'cm';
  if (normalized.startsWith('uni') || normalized.startsWith('ud')) return 'unit';
  if (normalized.startsWith('pack') || normalized.startsWith('paq') || normalized.startsWith('pak')) return 'pack';
  if (normalized.startsWith('bul')) return 'bundle';
  if (normalized.startsWith('doc')) return 'dozen';
  if (normalized.startsWith('caj') || normalized.startsWith('box')) return 'box';

  return null;
};

export const buildProductDisplayName = (
  product: {
    name: string;
    unit?: string | null;
    unitValue?: string | number | null;
    secondaryUnit?: string | null;
    secondaryUnitValue?: string | number | null;
  },
  variant?: { name: string | null } | null
): string => {
  const unit = product.unit || 'unit';
  const unitValue = product.unitValue?.toString().trim();
  let base = product.name;

  if (unit !== 'unit' && unitValue) {
    const short = UNIT_SHORT_LABELS[unit] || unit;
    base = `${base} ${unitValue} ${short}`.trim();
  }

  if (product.secondaryUnit) {
    const label = SECONDARY_UNIT_LABELS[product.secondaryUnit] || product.secondaryUnit;
    const value = product.secondaryUnitValue?.toString().trim();
    base = value ? `${base} ${label} ${value}`.trim() : `${base} ${label}`.trim();
  }

  if (variant?.name) {
    base = `${base} - ${variant.name}`.trim();
  }

  return base;
};

export interface UnitHint {
  unit?: string;
  value?: number;
  raw?: string;
}

export const extractUnitHints = (query: string): UnitHint[] => {
  const hints: UnitHint[] = [];
  if (!query) return hints;

  const normalized = query.toLowerCase().replace(/,/g, '.');
  const numberRegex = /(\d+(?:\.\d+)?)(?:\s*([a-zA-Z]+))?/g;
  let match: RegExpExecArray | null;

  while ((match = numberRegex.exec(normalized))) {
    const value = normalizeNumber(match[1]);
    if (value === null) continue;
    const unitToken = match[2];
    const unit = unitToken ? normalizeUnitToken(unitToken) : null;
    const hasDecimal = match[1].includes('.');

    if (unit) {
      hints.push({ unit, value, raw: match[0] });
    } else if (hasDecimal) {
      // Decimal number without explicit unit -> likely a size (2.25)
      hints.push({ value, raw: match[0] });
    }
  }

  const tokens = normalized
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .map((token) => token.trim())
    .filter(Boolean);

  for (const token of tokens) {
    const unit = normalizeUnitToken(token);
    if (unit && !hints.some((h) => h.unit === unit)) {
      hints.push({ unit });
    }
  }

  return hints;
};

const toBaseUnit = (unit: string, value: number) => {
  const info = BASE_UNIT_FACTORS[unit];
  if (!info) return { base: unit, value };
  return { base: info.base, value: value * info.factor };
};

const isClose = (a: number, b: number, base: string) => {
  const tolerance = base === 'ml' || base === 'g' || base === 'cm' ? 1 : 0.01;
  return Math.abs(a - b) <= tolerance;
};

export const matchesUnitHints = (
  product: {
    unit?: string | null;
    unitValue?: string | number | null;
    secondaryUnit?: string | null;
    secondaryUnitValue?: string | number | null;
  },
  hints: UnitHint[]
): boolean => {
  if (!hints.length) return true;

  const productUnit = product.unit || 'unit';
  const productValue = normalizeNumber(product.unitValue);
  const secondaryUnit = product.secondaryUnit || undefined;
  const secondaryValue = normalizeNumber(product.secondaryUnitValue);
  const secondaryUnits = new Set(['pack', 'box', 'bundle', 'dozen']);

  return hints.some((hint) => {
    if (!hint.unit && hint.value === undefined) return false;

    if (hint.unit && !hint.value) {
      if (secondaryUnits.has(hint.unit)) {
        return secondaryUnit === hint.unit;
      }
      return hint.unit === productUnit;
    }

    if (hint.unit && secondaryUnits.has(hint.unit)) {
      if (!secondaryUnit || hint.unit !== secondaryUnit || hint.value === undefined) return false;
      if (secondaryUnit === 'dozen') {
        return isClose(12, hint.value, 'unit');
      }
      if (secondaryValue === null) return false;
      return isClose(secondaryValue, hint.value, 'unit');
    }

    if (productValue === null || hint.value === undefined) return false;

    if (!hint.unit) {
      return isClose(productValue, hint.value, productUnit);
    }

    if (hint.unit === productUnit) {
      return isClose(productValue, hint.value, productUnit);
    }

    const baseProduct = toBaseUnit(productUnit, productValue);
    const baseHint = toBaseUnit(hint.unit, hint.value);
    if (baseProduct.base !== baseHint.base) return false;
    return isClose(baseProduct.value, baseHint.value, baseProduct.base);
  });
};

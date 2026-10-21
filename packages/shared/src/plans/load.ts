const POUND_NUMERATOR = 45_359_237n;
const POUND_DENOMINATOR = 100_000_000n;
const MAX_KILOGRAM_HUNDREDTHS = 200_000n;

export class LoadValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoadValueError';
  }
}

export function normalizeLoad(value: string): string {
  return formatHundredths(parseLoadHundredths(value));
}

export function toCanonicalKilograms(value: string, unit: 'kg' | 'lb'): string {
  const hundredths = parseLoadHundredths(value);
  if (unit === 'kg') {
    return formatHundredths(hundredths);
  }
  return formatHundredths(poundsToKilogramHundredths(hundredths));
}

export function loadExceedsLimit(value: string, unit: 'kg' | 'lb'): boolean {
  const hundredths = parseLoadHundredths(value);
  const kilograms = unit === 'kg' ? hundredths : poundsToKilogramHundredths(hundredths);
  return kilograms > MAX_KILOGRAM_HUNDREDTHS;
}

function poundsToKilogramHundredths(hundredths: bigint): bigint {
  const product = hundredths * POUND_NUMERATOR;
  return (product + POUND_DENOMINATOR / 2n) / POUND_DENOMINATOR;
}

function parseLoadHundredths(value: string): bigint {
  const match = /^(\d{1,4})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) {
    throw new LoadValueError('Informe a carga com até duas casas decimais.');
  }
  const fraction = (match[2] ?? '').padEnd(2, '0');
  return BigInt(match[1] ?? '0') * 100n + BigInt(fraction);
}

function formatHundredths(value: bigint): string {
  const whole = value / 100n;
  const fraction = (value % 100n).toString().padStart(2, '0');
  return `${whole.toString()}.${fraction}`;
}

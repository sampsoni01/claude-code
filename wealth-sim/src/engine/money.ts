import type { Money } from './types';

export function round2(n: number): Money {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function approxEqual(a: number, b: number, tol = 0.011): boolean {
  return Math.abs(a - b) <= tol;
}

/** Round a rough estimate to a sensible number of significant figures to avoid false precision. */
export function roundEstimate(n: number, sig = 2): Money {
  if (n === 0) return 0;
  const mag = Math.floor(Math.log10(Math.abs(n)));
  const factor = Math.pow(10, Math.max(0, mag - sig + 1));
  return Math.round(n / factor) * factor;
}

export function formatMoney(n: Money, currency = 'USD', compact = false): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  const sym = currencySymbol(currency);
  if (compact) {
    if (abs >= 1e9) return `${sign}${sym}${(abs / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `${sign}${sym}${(abs / 1e6).toFixed(2)}M`;
    if (abs >= 1e3) return `${sign}${sym}${(abs / 1e3).toFixed(1)}K`;
  }
  return `${sign}${sym}${abs.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export function currencySymbol(c: string): string {
  switch (c) {
    case 'USD': return '$';
    case 'GBP': return '£';
    case 'EUR': return '€';
    case 'CHF': return 'CHF ';
    case 'AED': return 'AED ';
    case 'SGD': return 'S$';
    default: return c + ' ';
  }
}

export function pct(n: number, digits = 1): string {
  return `${(n * 100).toFixed(digits)}%`;
}

/** Human label for snake_case identifiers. */
export function label(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

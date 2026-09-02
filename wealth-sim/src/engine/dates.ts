import type { ISODate, RecurrenceInterval } from './types';

export function parseDate(d: ISODate): { y: number; m: number; d: number } {
  const [y, m, dd] = d.split('-').map(Number);
  return { y, m, d: dd };
}

export function toISO(y: number, m: number, d: number): ISODate {
  return `${y.toString().padStart(4, '0')}-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
}

function toUTC(d: ISODate): Date {
  const p = parseDate(d);
  return new Date(Date.UTC(p.y, p.m - 1, p.d));
}

function fromUTC(dt: Date): ISODate {
  return toISO(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function addDays(d: ISODate, n: number): ISODate {
  const dt = toUTC(d);
  dt.setUTCDate(dt.getUTCDate() + n);
  return fromUTC(dt);
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Add months, clamping the day to the end of the target month. */
export function addMonths(d: ISODate, n: number): ISODate {
  const p = parseDate(d);
  const total = p.m - 1 + n;
  const y = p.y + Math.floor(total / 12);
  const m = ((total % 12) + 12) % 12 + 1;
  const day = Math.min(p.d, daysInMonth(y, m));
  return toISO(y, m, day);
}

export function addYears(d: ISODate, n: number): ISODate {
  return addMonths(d, n * 12);
}

export function addInterval(d: ISODate, interval: RecurrenceInterval): ISODate {
  switch (interval) {
    case 'daily': return addDays(d, 1);
    case 'weekly': return addDays(d, 7);
    case 'monthly': return addMonths(d, 1);
    case 'quarterly': return addMonths(d, 3);
    case 'annual': return addMonths(d, 12);
  }
}

export function intervalsPerYear(interval: RecurrenceInterval): number {
  switch (interval) {
    case 'daily': return 365;
    case 'weekly': return 52;
    case 'monthly': return 12;
    case 'quarterly': return 4;
    case 'annual': return 1;
  }
}

export function compareDates(a: ISODate, b: ISODate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((toUTC(b).getTime() - toUTC(a).getTime()) / 86_400_000);
}

export function monthsBetween(a: ISODate, b: ISODate): number {
  const pa = parseDate(a), pb = parseDate(b);
  return (pb.y - pa.y) * 12 + (pb.m - pa.m);
}

export function yearOf(d: ISODate): number { return parseDate(d).y; }
export function monthOf(d: ISODate): number { return parseDate(d).m; }
export function dayOf(d: ISODate): number { return parseDate(d).d; }
export function isFirstOfMonth(d: ISODate): boolean { return dayOf(d) === 1; }
export function startOfMonth(d: ISODate): ISODate { const p = parseDate(d); return toISO(p.y, p.m, 1); }
export function endOfMonth(d: ISODate): ISODate { const p = parseDate(d); return toISO(p.y, p.m, daysInMonth(p.y, p.m)); }

export function formatDate(d: ISODate): string {
  const p = parseDate(d);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[p.m - 1]} ${p.d}, ${p.y}`;
}

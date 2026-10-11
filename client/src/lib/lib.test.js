import { describe, expect, it } from 'vitest';
import { CSV_BOM, parseCsv, toCsv } from './csv.js';
import { addDays, dateLabel, delta, initials, isoDate, money, moneyRound, parseDate, percent, plural, relativeDay, titleCase } from './format.js';
import { qs } from './api.js';

describe('csv', () => {
  it('quotes fields and escapes embedded quotes', () => {
    expect(toCsv([['Name', 'Note'], ['Rice "Basmati"', 'a,b']])).toBe('"Name","Note"\r\n"Rice ""Basmati""","a,b"');
  });
  it('neutralises spreadsheet formulas but leaves real numbers alone', () => {
    expect(toCsv([['=HYPERLINK("x")', '-5', '+91 98765', '@cmd']])).toBe(`"'=HYPERLINK(""x"")","-5","'+91 98765","'@cmd"`);
  });
  it('round-trips quoted commas, quotes and newlines', () => {
    const rows = [['a', 'b,c', 'say "hi"', 'line1\nline2'], ['1', '', '3', '4']];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
  it('handles CRLF, blank lines and a leading BOM', () => {
    expect(parseCsv(`${CSV_BOM}Name,SKU\r\nRice,R-1\r\n\r\nDal,D-1\r\n`)).toEqual([['Name', 'SKU'], ['Rice', 'R-1'], ['Dal', 'D-1']]);
  });
  it('uses a real byte-order mark', () => { expect(CSV_BOM.charCodeAt(0)).toBe(0xFEFF); expect(CSV_BOM).toHaveLength(1); });
});

describe('format', () => {
  it('prints whole rupees without paise and fractions with two decimals', () => {
    expect(money(540)).toBe('₹540');
    expect(money(340.1)).toBe('₹340.10');
    expect(money(1234567.5)).toBe('₹12,34,567.50');
    expect(money(null)).toBe('₹0');
    expect(moneyRound(99.6)).toBe('₹100');
  });
  it('parses date strings as local calendar dates', () => {
    const d = parseDate('2026-03-01 09:30:00');
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 2, 1, 9]);
    expect(parseDate('nonsense')).toBeNull();
    expect(dateLabel('2026-03-01')).toMatch(/01 Mar 2026/);
    expect(dateLabel('')).toBe('—');
  });
  it('describes recent days relatively', () => {
    expect(relativeDay(isoDate())).toBe('Today');
    expect(relativeDay(isoDate(addDays(-1)))).toBe('Yesterday');
    expect(relativeDay(isoDate(addDays(-5)))).toBe('5 days ago');
  });
  it('computes deltas, labels and initials safely', () => {
    expect(delta(150, 100)).toBe(50);
    expect(delta(10, 0)).toBeNull();
    expect(percent(12.5)).toBe('12.5%');
    expect(percent(10)).toBe('10%');
    expect(initials('Asha Raman Iyer')).toBe('AR');
    expect(initials('')).toBe('?');
    expect(titleCase('low_stock')).toBe('Low Stock');
    expect(plural(1, 'sale')).toBe('1 sale');
    expect(plural(2, 'sale')).toBe('2 sales');
  });
});

describe('api helpers', () => {
  it('builds query strings, skipping empty and "all" values', () => {
    expect(qs({ q: 'rice', status: 'all', page: 2, empty: '', none: undefined })).toBe('?q=rice&page=2');
    expect(qs({})).toBe('');
    expect(qs({ q: 'a&b=c' })).toBe('?q=a%26b%3Dc');
  });
});

import { describe, expect, it } from 'vitest';
import {
  assistantQueryString,
  describeSchedule,
  formatNaira,
  nairaToKobo,
  parseAssistantSearch,
  parseService,
  todayInLagos,
  validateQuoteAmount,
} from './requests';

describe('money', () => {
  it('formats integer kobo exactly', () => {
    expect(formatNaira(250_000)).toBe('₦2,500');
    expect(formatNaira(250_050)).toBe('₦2,500.50');
    expect(formatNaira(10_000)).toBe('₦100');
    expect(formatNaira(1_999)).toBe('₦19.99');
    expect(formatNaira(123_456_789)).toBe('₦1,234,567.89');
  });

  it('parses typed amounts without floating point', () => {
    expect(nairaToKobo('2500')).toBe(250_000);
    expect(nairaToKobo('2,500.5')).toBe(250_050);
    expect(nairaToKobo('₦ 19.99')).toBe(1_999);
    expect(nairaToKobo('0.10')).toBe(10);
    expect(nairaToKobo('1.15')).toBe(115); // 1.15 * 100 === 114.99999999999999 with floats
    expect(nairaToKobo('4.35')).toBe(435);
    for (const bad of ['', 'abc', '12.345', '-5', '1e3', '1..2', '12,34,56.7.8', '9999999999'])
      expect(nairaToKobo(bad)).toBeNull();
  });

  it('round-trips every kobo value across a range', () => {
    for (let kobo = 10_000; kobo < 12_000; kobo += 1) {
      const text = formatNaira(kobo).replace('₦', '');
      expect(nairaToKobo(text)).toBe(kobo);
    }
  });

  it('applies the documented quote bounds', () => {
    expect(validateQuoteAmount('')).toMatch(/Enter your price/);
    expect(validateQuoteAmount('abc')).toMatch(/like 2500/);
    expect(validateQuoteAmount('99.99')).toMatch(/minimum/);
    expect(validateQuoteAmount('500,000.01')).toMatch(/maximum/);
    expect(validateQuoteAmount('100')).toBeUndefined();
    expect(validateQuoteAmount('500000')).toBeUndefined();
  });
});

describe('schedule text', () => {
  it('describes flexible and dated requests', () => {
    expect(describeSchedule({ kind: 'FLEXIBLE', date: null, period: 'ANY' })).toMatch(/Flexible/);
    expect(describeSchedule({ kind: 'ON_DATE', date: '2026-10-31', period: 'MORNING' })).toBe(
      'Saturday, 31 October 2026, morning',
    );
    expect(describeSchedule({ kind: 'ON_DATE', date: '2026-10-31', period: 'ANY' })).toBe(
      'Saturday, 31 October 2026',
    );
  });

  it('computes today in Lagos, not UTC', () => {
    expect(todayInLagos(new Date('2026-10-24T23:30:00Z'))).toBe('2026-10-25');
    expect(todayInLagos(new Date('2026-10-24T12:00:00Z'))).toBe('2026-10-24');
  });
});

describe('assistant search parameters', () => {
  const langs = ['en', 'yo', 'ha'];

  it('splits the combined service value into category and task', () => {
    expect(parseService('banks')).toEqual({ category: 'banks' });
    expect(parseService('banks/open-account')).toEqual({ category: 'banks', task: 'open-account' });
    expect(parseService('banks/Bad Task')).toEqual({ category: 'banks' });
    expect(parseService('a/b/c')).toEqual({});
    expect(parseService('BAD')).toEqual({});
    expect(parseService(undefined)).toEqual({});
  });

  it('drops anything invalid instead of forwarding it', () => {
    const p = parseAssistantSearch(
      { city: 'lagos', service: 'banks/hold', language: 'klingon', q: '  ada   o ', page: '0' },
      langs,
    );
    expect(p).toEqual({
      city: 'lagos',
      service: 'banks/hold',
      language: undefined,
      q: 'ada o',
      page: 1,
    });
    expect(parseAssistantSearch({ city: '../etc', page: 'x' }, langs)).toMatchObject({
      city: undefined,
      page: 1,
    });
  });

  it('builds page links with service and API calls with category/task', () => {
    const params = { city: 'lagos', service: 'banks/hold', language: 'yo', q: 'ada', page: 2 };
    expect(assistantQueryString(params)).toBe(
      'city=lagos&service=banks%2Fhold&language=yo&q=ada&page=2',
    );
    expect(assistantQueryString(params, { forApi: true, pageSize: 12 })).toBe(
      'city=lagos&category=banks&task=hold&language=yo&q=ada&page=2&pageSize=12',
    );
    expect(assistantQueryString({ page: 1 })).toBe('');
  });
});

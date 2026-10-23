import { safeNextPath } from './safe-redirect';

describe('safeNextPath', () => {
  it('allows same-site relative paths', () => {
    expect(safeNextPath('/account')).toBe('/account');
    expect(safeNextPath('/search?q=lagos&page=2')).toBe('/search?q=lagos&page=2');
  });

  it.each([
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    'javascript:alert(1)',
    'account',
    '/ok\n/evil',
    '/\t/evil.example',
    '',
    undefined,
  ])('rejects %j', (value) => {
    expect(safeNextPath(value)).toBe('/account');
  });

  it('uses the first value of repeated params and honours the fallback', () => {
    expect(safeNextPath(['/a', 'https://evil.example'])).toBe('/a');
    expect(safeNextPath('//x', '/')).toBe('/');
    expect(safeNextPath('/' + 'a'.repeat(300))).toBe('/account');
  });
});

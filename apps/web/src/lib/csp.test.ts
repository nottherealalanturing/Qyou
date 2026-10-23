import { buildCsp, generateNonce } from './csp';

const prod = { nonce: 'abc123==', dev: false, forceHttps: false };

function directive(csp: string, name: string): string {
  return csp.split('; ').find((d) => d.startsWith(`${name} `)) ?? '';
}

describe('buildCsp', () => {
  it('allows scripts only from self or with the request nonce, with no unsafe-inline/eval in production', () => {
    const scripts = directive(buildCsp(prod), 'script-src');
    expect(scripts).toContain("'nonce-abc123=='");
    expect(scripts).toContain("'strict-dynamic'");
    expect(scripts).not.toContain('unsafe-inline');
    expect(scripts).not.toContain('unsafe-eval');
  });

  it('adds unsafe-eval only in development', () => {
    expect(directive(buildCsp({ ...prod, dev: true }), 'script-src')).toContain("'unsafe-eval'");
    expect(buildCsp(prod)).not.toContain('unsafe-eval');
  });

  it('never uses unsafe-inline in production, and in development only for styles (never scripts)', () => {
    expect(buildCsp(prod)).not.toContain('unsafe-inline');
    const dev = buildCsp({ ...prod, dev: true });
    expect(dev.match(/unsafe-inline/g)).toHaveLength(1);
    expect(directive(dev, 'style-src')).toBe("style-src 'self' 'unsafe-inline'");
    expect(directive(dev, 'script-src')).not.toContain('unsafe-inline');
  });

  it('never uses wildcards anywhere', () => {
    for (const dev of [true, false]) {
      const csp = buildCsp({ ...prod, dev });
      expect(csp).not.toMatch(/(^|\s)\*(\s|;|$)/);
      expect(csp).not.toMatch(/https?:\/\/\*/);
    }
  });

  it('locks down framing, plugins, base URI and form targets', () => {
    const csp = buildCsp(prod);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(directive(csp, 'connect-src')).toBe("connect-src 'self'");
    expect(directive(csp, 'default-src')).toBe("default-src 'self'");
  });

  it('adds upgrade-insecure-requests only when HTTPS is enforced', () => {
    expect(buildCsp(prod)).not.toContain('upgrade-insecure-requests');
    expect(buildCsp({ ...prod, forceHttps: true })).toContain('upgrade-insecure-requests');
  });

  it('uses the nonce for styles in production', () => {
    expect(directive(buildCsp(prod), 'style-src')).toBe("style-src 'self' 'nonce-abc123=='");
  });
});

describe('generateNonce', () => {
  it('is unpredictable per call and valid base64', () => {
    const nonces = new Set(Array.from({ length: 100 }, generateNonce));
    expect(nonces.size).toBe(100);
    for (const nonce of nonces) expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });
});

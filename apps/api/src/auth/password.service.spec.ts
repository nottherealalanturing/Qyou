import { PasswordService } from './password.service.js';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('hashes with Argon2id and the configured parameters', async () => {
    const hashed = await service.hash('correct horse battery staple');
    expect(hashed).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(hashed).not.toContain('correct horse');
  });

  it('salts: the same password yields different hashes', async () => {
    const [a, b] = await Promise.all([
      service.hash('same-password-1'),
      service.hash('same-password-1'),
    ]);
    expect(a).not.toBe(b);
  });

  it('verifies the right password and rejects the wrong one', async () => {
    const hashed = await service.hash('right-password-123');
    await expect(service.verify(hashed, 'right-password-123')).resolves.toBe(true);
    await expect(service.verify(hashed, 'wrong-password-123')).resolves.toBe(false);
  });

  it('treats a malformed stored hash as a failed verification instead of throwing', async () => {
    await expect(service.verify('not-a-hash', 'anything')).resolves.toBe(false);
  });

  it('can run the timing-equalisation path without error', async () => {
    await expect(service.verifyAgainstDummy('whatever')).resolves.toBeUndefined();
  });
});

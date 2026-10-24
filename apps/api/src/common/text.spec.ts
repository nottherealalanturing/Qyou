import { escapeLike, nameField, nameKey, slugField, slugify, textField } from './text.js';

describe('text helpers', () => {
  it('slugifies free text to a valid slug', () => {
    expect(slugify('Banks & Payment Offices')).toBe('banks-and-payment-offices');
    expect(slugify('  Ẹ̀kọ́ Ìlú  Kaduna! ')).toBe('eko-ilu-kaduna');
    expect(slugify('Naira--Exchange  ')).toBe('naira-exchange');
    expect(slugify('日本語')).toBe('');
    expect(slugify('a'.repeat(100), 20)).toHaveLength(20);
  });

  it('builds a case/space-insensitive name key', () => {
    expect(nameKey('  Banks   &  Payments ')).toBe(nameKey('banks & payments'));
    expect(nameKey('Banks')).not.toBe(nameKey('Bank'));
  });

  it('validates slugs', () => {
    const schema = slugField();
    for (const ok of ['ab', 'abuja', 'banks-and-payments', 'a1-b2'])
      expect(schema.safeParse(ok).success).toBe(true);
    for (const bad of ['', 'a', 'Abuja', 'a b', '-a', 'a-', 'a--b', 'a_b', 'é', 'x'.repeat(61)]) {
      expect(schema.safeParse(bad).success).toBe(false);
    }
  });

  it('normalises names and rejects control characters', () => {
    const schema = nameField(2, 20);
    expect(schema.parse('  Banks   Office ')).toBe('Banks Office');
    expect(schema.safeParse('A\u0000B').success).toBe(false);
    expect(schema.safeParse('x').success).toBe(false);
    expect(schema.safeParse('x'.repeat(21)).success).toBe(false);
  });

  it('allows newlines in free text but no other control characters', () => {
    const schema = textField(50);
    expect(schema.parse('line one\nline two')).toBe('line one\nline two');
    expect(schema.safeParse('bad\u0007bell').success).toBe(false);
    expect(schema.safeParse('   ').success).toBe(false);
  });

  it('escapes LIKE metacharacters so search text is literal', () => {
    expect(escapeLike('100%')).toBe('100\\%');
    expect(escapeLike('a_b')).toBe('a\\_b');
    expect(escapeLike('back\\slash')).toBe('back\\\\slash');
    expect(escapeLike('plain text')).toBe('plain text');
  });
});

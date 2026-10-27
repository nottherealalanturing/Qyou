import { describe, expect, it } from 'vitest';
import { containsContactDetails } from './contact-guard.js';

describe('containsContactDetails', () => {
  it.each([
    'call me on 0803 123 4567',
    'my number is +234-803-123-4567',
    'email me at ada@example.com',
    'see https://example.com/form',
    'visit www.example.com',
    'NIN 12345678901',
  ])('flags %s', (text) => expect(containsContactDetails(text)).toBe(true));

  it.each([
    'Hold my place in the line for the 8am slot at the Ikeja branch.',
    'Bring 3 forms and ticket A12; ask for the supervisor.',
    'Queue number 4521 on the 14th of November',
    'I will be at the 2nd floor, room 12, from 08:00 to 10:30.',
  ])('allows ordinary instructions: %s', (text) =>
    expect(containsContactDetails(text)).toBe(false),
  );
});

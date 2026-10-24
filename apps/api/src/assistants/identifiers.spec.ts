import { looksLikeIdentifier } from './identifiers.js';

describe('looksLikeIdentifier', () => {
  it.each([
    '12345678901', // NIN/BVN-shaped
    'NIN 1234 5678 901',
    'bvn: 222-333-444-55',
    '4111 1111 1111 1111', // card
    '08031234567', // phone
    'ref 1234567890',
  ])('flags %j', (text) => {
    expect(looksLikeIdentifier(text)).toBe(true);
  });

  it.each([
    'VID-2026-1042',
    'Video call 12 May, passport checked in person',
    'Ticket 4471',
    'Reviewer: Ada. Details held in the HR vault.',
    '',
    'ID matched name on application (8 digits shown: 12345678)',
  ])('allows %j', (text) => {
    expect(looksLikeIdentifier(text)).toBe(false);
  });
});

import type { Eligibility } from './catalog';

export interface EligibilityView {
  label: string;
  /** Short, plain-language meaning shown next to the badge. */
  meaning: string;
  /** Text + icon always accompany colour, so meaning never depends on colour alone. */
  icon: '✓' | '✎' | '✕';
  tone: 'good' | 'caution' | 'blocked';
}

export const ELIGIBILITY: Record<Eligibility, EligibilityView> = {
  ELIGIBLE: {
    label: 'Available',
    meaning: 'An assistant can do this for you.',
    icon: '✓',
    tone: 'good',
  },
  REQUIRES_AUTHORIZATION: {
    label: 'Needs your authorization',
    meaning: 'An assistant can do this only with the documents described below.',
    icon: '✎',
    tone: 'caution',
  },
  NOT_DELEGABLE: {
    label: 'Not available',
    meaning: 'This must be done by you personally. Qyou assistants cannot do it.',
    icon: '✕',
    tone: 'blocked',
  },
};

/** Display order: what people can book first, what they cannot last. */
export const ELIGIBILITY_ORDER: Eligibility[] = [
  'ELIGIBLE',
  'REQUIRES_AUTHORIZATION',
  'NOT_DELEGABLE',
];

export function groupByEligibility<T>(
  items: T[],
  pick: (item: T) => Eligibility,
): { eligibility: Eligibility; items: T[] }[] {
  return ELIGIBILITY_ORDER.map((eligibility) => ({
    eligibility,
    items: items.filter((item) => pick(item) === eligibility),
  })).filter((group) => group.items.length > 0);
}

export function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** "Lagos" for Lagos, Lagos; "Abuja, Federal Capital Territory" otherwise. */
export function placeLabel(city: { name: string; state: string }): string {
  return city.name.trim().toLowerCase() === city.state.trim().toLowerCase()
    ? city.name
    : `${city.name}, ${city.state}`;
}

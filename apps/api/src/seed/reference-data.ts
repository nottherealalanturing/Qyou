import type { TaskEligibility, TaskKind } from '../generated/prisma/client.js';

/**
 * Launch reference data. This is the ONLY data the seed creates:
 *   - four launch cities (places, not venues),
 *   - service categories (kinds of places people queue at),
 *   - eligible tasks per category, with explicit delegation rules.
 * It deliberately contains NO locations/businesses, assistants, reviews or wait times: those must
 * come from real sources (administrators, businesses, the community), never from a seed file.
 *
 * City coordinates are approximate city centres. Eligibility text is product policy (see
 * docs/PRODUCT.md "Scope rules") and is advisory about third-party rules: venues and agencies set
 * their own requirements, which administrators record per venue as LocationRestriction rows.
 */

export interface SeedCity {
  slug: string;
  name: string;
  state: string;
  latitude: number;
  longitude: number;
  sortOrder: number;
}

export interface SeedTask {
  slug: string;
  name: string;
  description: string;
  kind: TaskKind;
  eligibility: TaskEligibility;
  requiresPersonalPresence?: boolean;
  requiresCredentials?: boolean;
  authorizationNotes?: string;
  restrictionNotes?: string;
}

export interface SeedCategory {
  slug: string;
  name: string;
  description: string;
  iconKey: string;
  tasks: SeedTask[];
}

export const SEED_CITIES: SeedCity[] = [
  {
    slug: 'kaduna',
    name: 'Kaduna',
    state: 'Kaduna',
    latitude: 10.5105,
    longitude: 7.4165,
    sortOrder: 1,
  },
  {
    slug: 'abuja',
    name: 'Abuja',
    state: 'Federal Capital Territory',
    latitude: 9.0765,
    longitude: 7.3986,
    sortOrder: 2,
  },
  { slug: 'kano', name: 'Kano', state: 'Kano', latitude: 12.0022, longitude: 8.5919, sortOrder: 3 },
  {
    slug: 'lagos',
    name: 'Lagos',
    state: 'Lagos',
    latitude: 6.5244,
    longitude: 3.3792,
    sortOrder: 4,
  },
];

const holdPlace = (where: string): SeedTask => ({
  slug: 'hold-place-in-line',
  name: 'Hold your place in line',
  description: `Wait in line at ${where} for you and hand your place back before you are served.`,
  kind: 'QUEUE_HOLDING',
  eligibility: 'ELIGIBLE',
});

export const SEED_CATEGORIES: SeedCategory[] = [
  {
    slug: 'government-services',
    name: 'Government & civic offices',
    description: 'Licensing, registration and other public-service offices where queues are long.',
    iconKey: 'landmark',
    tasks: [
      holdPlace('a government office'),
      {
        slug: 'submit-prepared-documents',
        name: 'Submit documents you have already prepared',
        description: 'Hand in completed forms and supporting documents at the counter.',
        kind: 'ERRAND',
        eligibility: 'REQUIRES_AUTHORIZATION',
        authorizationNotes:
          'A signed letter of authorization from you, a copy of your ID, and the completed documents. The office may refuse third-party submissions; check its requirements first.',
      },
      {
        slug: 'collect-forms-or-receipts',
        name: 'Collect blank forms or a completed receipt',
        description: 'Pick up forms, or a receipt or slip that is ready for collection.',
        kind: 'ERRAND',
        eligibility: 'REQUIRES_AUTHORIZATION',
        authorizationNotes:
          'Your reference number and a signed authorization letter naming the assistant. Some offices release items only to the applicant.',
      },
      {
        slug: 'biometric-or-identity-capture',
        name: 'Biometric or identity capture',
        description:
          'Fingerprints, photographs, NIN or passport enrolment and similar in-person steps.',
        kind: 'ERRAND',
        eligibility: 'NOT_DELEGABLE',
        requiresPersonalPresence: true,
        restrictionNotes:
          'These steps verify that you are you and must be done in person. Qyou assistants can never stand in for you.',
      },
      {
        slug: 'operate-your-online-portal-account',
        name: 'Use your online government portal account',
        description: 'Logging in to or acting through your personal government account.',
        kind: 'ERRAND',
        eligibility: 'NOT_DELEGABLE',
        requiresCredentials: true,
        restrictionNotes:
          'Assistants never receive or use your passwords, PINs or one-time codes. Complete online steps yourself.',
      },
    ],
  },
  {
    slug: 'banks-and-payments',
    name: 'Banks & payment offices',
    description: 'Branch queues for banks and payment service providers.',
    iconKey: 'bank',
    tasks: [
      holdPlace('a bank branch'),
      {
        slug: 'collect-queue-ticket',
        name: 'Get a queue ticket and wait for your number',
        description: 'Take a ticket and wait so you can arrive just before you are called.',
        kind: 'QUEUE_HOLDING',
        eligibility: 'ELIGIBLE',
      },
      {
        slug: 'handle-customer-cash',
        name: 'Deposit, withdraw or carry cash for you',
        description: 'Any task where the assistant handles your money.',
        kind: 'ERRAND',
        eligibility: 'NOT_DELEGABLE',
        restrictionNotes:
          'Not offered at launch: Qyou does not have the safeguards needed to let assistants handle customers’ cash.',
      },
      {
        slug: 'card-pin-or-account-access',
        name: 'Use your card, PIN or banking app',
        description: 'Transfers, withdrawals or any action that needs your card, PIN or app login.',
        kind: 'ERRAND',
        eligibility: 'NOT_DELEGABLE',
        requiresCredentials: true,
        restrictionNotes:
          'Never share your card, PIN, passwords or one-time codes with anyone, including assistants.',
      },
      {
        slug: 'account-opening-or-kyc',
        name: 'Account opening or identity (KYC) verification',
        description: 'Steps where the bank must see and verify you in person.',
        kind: 'ERRAND',
        eligibility: 'NOT_DELEGABLE',
        requiresPersonalPresence: true,
        restrictionNotes:
          'Banks must verify the account holder in person; this cannot be delegated.',
      },
    ],
  },
  {
    slug: 'healthcare-facilities',
    name: 'Hospitals & clinics',
    description: 'Registration, records and pharmacy queues at health facilities.',
    iconKey: 'heart-pulse',
    tasks: [
      holdPlace('a hospital or clinic registration desk or pharmacy'),
      {
        slug: 'collect-results-or-records',
        name: 'Collect test results or records',
        description: 'Pick up documents that are ready for collection.',
        kind: 'ERRAND',
        eligibility: 'REQUIRES_AUTHORIZATION',
        authorizationNotes:
          'A signed consent letter naming the assistant and your patient reference. Facilities may release records only to the patient; medical privacy rules apply.',
      },
      {
        slug: 'medical-consultation-or-procedures',
        name: 'Consultations, examinations or procedures',
        description: 'Anything that involves a clinician seeing or treating the patient.',
        kind: 'ERRAND',
        eligibility: 'NOT_DELEGABLE',
        requiresPersonalPresence: true,
        restrictionNotes:
          'The patient must be present. Assistants can only help with waiting and paperwork.',
      },
    ],
  },
  {
    slug: 'transport-and-travel',
    name: 'Transport & travel',
    description: 'Ticket offices, terminals and motor parks.',
    iconKey: 'bus',
    tasks: [
      holdPlace('a ticket office, terminal or motor park'),
      {
        slug: 'collect-pre-booked-ticket',
        name: 'Collect a ticket you have already booked',
        description: 'Pick up a ticket or boarding document you reserved in advance.',
        kind: 'ERRAND',
        eligibility: 'REQUIRES_AUTHORIZATION',
        authorizationNotes:
          'Your booking reference and a signed authorization letter. The operator may require the traveller’s ID.',
      },
      {
        slug: 'security-or-immigration-checks',
        name: 'Security, immigration or identity checks',
        description: 'Any check that screens or identifies the traveller.',
        kind: 'ERRAND',
        eligibility: 'NOT_DELEGABLE',
        requiresPersonalPresence: true,
        restrictionNotes:
          'These checks apply to the traveller personally and cannot be done by anyone else.',
      },
    ],
  },
  {
    slug: 'utilities-and-telecom',
    name: 'Utilities & telecom',
    description: 'Electricity, water and telecom service offices.',
    iconKey: 'bolt',
    tasks: [
      holdPlace('a utility or telecom office'),
      {
        slug: 'submit-service-request-forms',
        name: 'Submit a service request or complaint form',
        description: 'Hand in a prepared meter, billing or service form.',
        kind: 'ERRAND',
        eligibility: 'REQUIRES_AUTHORIZATION',
        authorizationNotes:
          'The completed form, your account or meter number, and a signed authorization letter.',
      },
      {
        slug: 'sim-registration-or-replacement',
        name: 'SIM registration or replacement',
        description: 'Registering or replacing a SIM card.',
        kind: 'ERRAND',
        eligibility: 'NOT_DELEGABLE',
        requiresPersonalPresence: true,
        restrictionNotes: 'SIM services require the subscriber’s identity verification in person.',
      },
    ],
  },
  {
    slug: 'education-and-admissions',
    name: 'Schools & admissions',
    description: 'Admission, registration and records offices at schools and universities.',
    iconKey: 'graduation-cap',
    tasks: [
      holdPlace('a school or university office'),
      {
        slug: 'submit-or-collect-documents',
        name: 'Submit or collect documents',
        description: 'Deliver prepared documents or collect a letter, transcript or receipt.',
        kind: 'ERRAND',
        eligibility: 'REQUIRES_AUTHORIZATION',
        authorizationNotes:
          'A signed authorization letter and a copy of the student’s or parent’s ID. Some documents are released only to the owner.',
      },
      {
        slug: 'sit-exams-or-assessments',
        name: 'Sit exams, tests or interviews',
        description: 'Taking an assessment on someone else’s behalf.',
        kind: 'ERRAND',
        eligibility: 'NOT_DELEGABLE',
        requiresPersonalPresence: true,
        restrictionNotes:
          'This would be impersonation. It is prohibited on Qyou in every circumstance.',
      },
    ],
  },
  {
    slug: 'pickups-and-retail',
    name: 'Pickups & retail',
    description: 'Collection points, stores and markets.',
    iconKey: 'shopping-bag',
    tasks: [
      holdPlace('a store, market or collection point'),
      {
        slug: 'collect-prepaid-order',
        name: 'Collect an order you have already paid for',
        description: 'Pick up a prepaid order or parcel.',
        kind: 'ERRAND',
        eligibility: 'REQUIRES_AUTHORIZATION',
        authorizationNotes:
          'Your order or tracking number and a signed authorization letter. The seller may require the buyer’s ID.',
      },
      {
        slug: 'buy-regulated-goods',
        name: 'Buy age-restricted or regulated goods',
        description: 'Alcohol, tobacco, prescription-only medicine and similar items.',
        kind: 'ERRAND',
        eligibility: 'NOT_DELEGABLE',
        restrictionNotes:
          'Not offered: these purchases carry legal checks on the buyer that assistants cannot satisfy.',
      },
    ],
  },
];

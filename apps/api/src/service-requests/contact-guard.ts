import { looksLikeIdentifier } from '../assistants/identifiers.js';

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const LINK = /(?:https?:\/\/|www\.)\S+/i;

/**
 * Free text on a request must not carry contact details or ID/phone-like numbers: Qyou keeps
 * contact data private and does not want conversations to leave the platform before messaging exists.
 * A tripwire, not a guarantee: it catches the obvious forms only.
 */
export function containsContactDetails(text: string): boolean {
  return EMAIL.test(text) || LINK.test(text) || looksLikeIdentifier(text);
}

export const CONTACT_DETAILS_MESSAGE =
  'Please remove phone numbers, email addresses, links and ID numbers. Qyou keeps contact details private.';

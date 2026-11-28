import type { FieldErrors } from './validation';

export type SubmitResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; message: string; fieldErrors: FieldErrors; blockers: string[] };

interface ApiErrorBody {
  blockers?: unknown;
  code?: unknown;
  message?: unknown;
  issues?: { path?: unknown; message?: unknown }[];
  retryAfterSeconds?: unknown;
}

function retryHint(seconds: unknown): string {
  if (typeof seconds !== 'number' || seconds <= 0) return '';
  const minutes = Math.ceil(seconds / 60);
  return ` Try again in about ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`;
}

/**
 * Maps an API error response to text that is safe and useful to show in the UI. Only a few messages
 * are passed through (validation and conflict messages are written for people); 401, 403, 404 and
 * everything unexpected get fixed wording, so raw server text and internal details never reach the page.
 */
export function describeError(status: number, body: ApiErrorBody): string {
  const message = typeof body.message === 'string' ? body.message : undefined;
  const code = typeof body.code === 'string' ? body.code : undefined;
  if (status === 400)
    return message === 'Validation failed'
      ? 'Please fix the highlighted fields.'
      : (message ?? 'That request was not valid.');
  if (status === 401) return message ?? 'Please log in again to continue.';
  if (status === 409) return message ?? 'Something went wrong.';
  if (status === 503) return message ?? 'This is not available right now.';
  if (status === 403) {
    if (code === 'ASSISTANT_NOT_ELIGIBLE')
      return 'You are not currently eligible to do this. Check your application for what is needed.';
    if (code === 'EMAIL_NOT_VERIFIED') return 'Verify your email address first, then try again.';
    if (message === 'Cross-site request blocked')
      return 'Your request was blocked. Reload the page and try again.';
    return 'You do not have permission to do this.';
  }
  if (status === 404)
    return 'We could not find that. It may have been closed or removed, or you may no longer be able to access it.';
  if (status === 413) return 'That request was too large.';
  if (status === 429) return `Too many attempts.${retryHint(body.retryAfterSeconds)}`;
  return 'Something went wrong on our side. Please try again in a moment.';
}

/** Send JSON to the same-origin API proxy. Never throws. */
export async function sendJson<T = unknown>(
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  payload?: unknown,
): Promise<SubmitResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
  } catch {
    return {
      ok: false,
      status: 0,
      message: 'We could not reach Qyou. Check your connection and try again.',
      fieldErrors: {},
      blockers: [],
    };
  }

  const text = await response.text();
  let body: unknown = undefined;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }

  if (response.ok) return { ok: true, data: body as T };

  const errorBody = (body ?? {}) as ApiErrorBody;
  const fieldErrors: FieldErrors = {};
  for (const issue of errorBody.issues ?? []) {
    if (
      typeof issue.path === 'string' &&
      typeof issue.message === 'string' &&
      !fieldErrors[issue.path]
    ) {
      fieldErrors[issue.path] = issue.message;
    }
  }
  return {
    ok: false,
    status: response.status,
    message: describeError(response.status, errorBody),
    fieldErrors,
    blockers: Array.isArray(errorBody.blockers)
      ? errorBody.blockers.filter((b): b is string => typeof b === 'string')
      : [],
  };
}

/** POST JSON to the same-origin API proxy. Never throws. */
export const postJson = <T = unknown>(path: string, payload: unknown) =>
  sendJson<T>('POST', path, payload);

import type { FieldErrors } from './validation';

export type SubmitResult<T> =
  { ok: true; data: T } | { ok: false; status: number; message: string; fieldErrors: FieldErrors };

interface ApiErrorBody {
  message?: unknown;
  issues?: { path?: unknown; message?: unknown }[];
  retryAfterSeconds?: unknown;
}

function retryHint(seconds: unknown): string {
  if (typeof seconds !== 'number' || seconds <= 0) return '';
  const minutes = Math.ceil(seconds / 60);
  return ` Try again in about ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`;
}

/** Maps an API error response to text that is safe and useful to show in the UI. */
export function describeError(status: number, body: ApiErrorBody): string {
  const message = typeof body.message === 'string' ? body.message : undefined;
  if (status === 400)
    return message === 'Validation failed'
      ? 'Please fix the highlighted fields.'
      : (message ?? 'That request was not valid.');
  if (status === 401 || status === 409) return message ?? 'Something went wrong.';
  if (status === 403) return 'Your request was blocked. Reload the page and try again.';
  if (status === 413) return 'That request was too large.';
  if (status === 429) return `Too many attempts.${retryHint(body.retryAfterSeconds)}`;
  return 'Something went wrong on our side. Please try again in a moment.';
}

/** POST JSON to the same-origin API proxy. Never throws. */
export async function postJson<T = unknown>(
  path: string,
  payload: unknown,
): Promise<SubmitResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    return {
      ok: false,
      status: 0,
      message: 'We could not reach Qyou. Check your connection and try again.',
      fieldErrors: {},
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
  };
}

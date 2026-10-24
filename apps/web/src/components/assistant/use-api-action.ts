'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { sendJson, type SubmitResult } from '@/lib/forms';
import type { FieldErrors } from '@/lib/validation';

/**
 * Shared state for a form that talks to the API: pending flag, a form-level error, per-field errors
 * from the API's `issues`, and a success notice. On success it refreshes the server-rendered page so
 * the dashboard always reflects what the API actually saved.
 */
export function useApiAction() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [notice, setNotice] = useState<string | null>(null);

  async function run<T = unknown>(
    method: 'POST' | 'PUT' | 'PATCH',
    path: string,
    body: unknown,
    options: { success?: string; refresh?: boolean } = {},
  ): Promise<SubmitResult<T>> {
    setPending(true);
    setError(null);
    setNotice(null);
    setFieldErrors({});
    const result = await sendJson<T>(method, path, body);
    setPending(false);
    if (result.ok) {
      if (options.success) setNotice(options.success);
      if (options.refresh !== false) router.refresh();
    } else {
      setFieldErrors(result.fieldErrors);
      // A field-level message is clearer than a generic banner when the API pointed at a field.
      setError(Object.keys(result.fieldErrors).length > 0 ? null : result.message);
    }
    return result;
  }

  return { run, pending, error, fieldErrors, notice };
}

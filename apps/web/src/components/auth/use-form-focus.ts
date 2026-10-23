'use client';

import { useEffect, useRef } from 'react';

/**
 * Returns refs for the form and its form-level alert. After a failed submit, focus moves to the
 * first invalid field, or to the alert when no field is invalid, so keyboard and screen-reader
 * users land on the problem. `attempt` must change on every failed submit.
 */
export function useFocusOnError(attempt: number) {
  const formRef = useRef<HTMLFormElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (attempt === 0) return; // no failed submit yet
    const invalid = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    (invalid ?? alertRef.current)?.focus();
  }, [attempt]);

  return { formRef, alertRef };
}

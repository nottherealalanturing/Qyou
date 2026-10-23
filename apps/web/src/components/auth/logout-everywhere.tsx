'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { postJson } from '@/lib/forms';
import { Alert } from '../ui/alert';
import { Button } from '../ui/button';

/** Two-step control: logging out everywhere also ends THIS session, so ask first. */
export function LogoutEverywhere() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function logoutAll() {
    setPending(true);
    setError(null);
    const result = await postJson('/api/v1/auth/logout-all', {});
    if (result.ok) {
      router.replace('/login');
      router.refresh();
      return;
    }
    setPending(false);
    setError(result.message);
  }

  if (!confirming) {
    return (
      <Button type="button" variant="secondary" onClick={() => setConfirming(true)}>
        Log out of all devices
      </Button>
    );
  }

  return (
    <div className="space-y-3" role="group" aria-label="Confirm logging out of all devices">
      <p className="text-sm text-ink-muted">
        This ends every session, including this one. You will need to log in again.
      </p>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="flex flex-wrap gap-3">
        <Button type="button" loading={pending} onClick={logoutAll}>
          {pending ? 'Logging out…' : 'Yes, log out everywhere'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={() => setConfirming(false)}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

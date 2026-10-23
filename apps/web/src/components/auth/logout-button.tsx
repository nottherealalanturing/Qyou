'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { postJson } from '@/lib/forms';
import { Button } from '../ui/button';

export function LogoutButton({
  variant = 'secondary',
  size = 'md',
}: {
  variant?: 'secondary' | 'ghost';
  size?: 'md' | 'sm';
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function logout() {
    setPending(true);
    setFailed(false);
    const result = await postJson('/api/v1/auth/logout', {});
    if (result.ok) {
      router.replace('/');
      router.refresh();
      return;
    }
    setPending(false);
    setFailed(true);
  }

  return (
    <>
      <Button type="button" variant={variant} size={size} loading={pending} onClick={logout}>
        {pending ? 'Logging out…' : 'Log out'}
      </Button>
      {failed ? (
        <span role="alert" className="text-sm font-medium text-danger">
          Could not log out. Try again.
        </span>
      ) : null}
    </>
  );
}

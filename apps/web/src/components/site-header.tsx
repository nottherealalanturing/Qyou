import Link from 'next/link';
import { getSession } from '@/lib/session';
import { LogoutButton } from './auth/logout-button';
import { buttonClasses } from './ui/button';

export async function SiteHeader() {
  const session = await getSession();

  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="text-xl font-bold tracking-tight text-brand-700">
          Qyou
        </Link>
        <nav aria-label="Account" className="flex items-center gap-2">
          {session.state === 'authenticated' ? (
            <>
              <Link href="/account" className={buttonClasses('ghost', 'sm')}>
                {session.user.name.split(' ')[0]}
              </Link>
              <LogoutButton variant="ghost" size="sm" />
            </>
          ) : (
            <>
              <Link href="/login" className={buttonClasses('ghost', 'sm')}>
                Log in
              </Link>
              <Link href="/register" className={buttonClasses('primary', 'sm')}>
                Sign up
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

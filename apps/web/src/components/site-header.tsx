import Link from 'next/link';
import { getSession } from '@/lib/session';
import { LogoutButton } from './auth/logout-button';
import { buttonClasses } from './ui/button';

export async function SiteHeader() {
  const session = await getSession();

  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex min-h-16 max-w-6xl flex-wrap items-center justify-between gap-x-2 px-4 py-2 sm:px-6">
        <Link href="/" className="text-xl font-bold tracking-tight text-brand-700">
          Qyou
        </Link>
        <nav
          aria-label="Account"
          className="flex flex-wrap items-center justify-end gap-1 sm:gap-2"
        >
          <Link href="/search" className={buttonClasses('ghost', 'sm')}>
            Explore
          </Link>
          <Link href="/assistants" className={buttonClasses('ghost', 'sm')}>
            Assistants
          </Link>
          {session.state === 'authenticated' ? (
            <>
              <Link href="/requests" className={buttonClasses('ghost', 'sm')}>
                Requests
              </Link>
              {session.user.role === 'ASSISTANT' ? (
                <Link href="/assistant/requests" className={buttonClasses('ghost', 'sm')}>
                  Jobs
                </Link>
              ) : null}
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

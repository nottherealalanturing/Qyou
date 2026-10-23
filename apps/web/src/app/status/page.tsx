import type { Metadata } from 'next';
import { getApiStatus } from '@/lib/api';

export const metadata: Metadata = { title: 'System status' };
export const dynamic = 'force-dynamic';

function Row({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <li className="flex items-center justify-between py-4">
      <span className="font-medium">{label}</span>
      <span className={ok ? 'font-semibold text-success' : 'font-semibold text-danger'}>
        {ok ? '● ' : '▲ '}
        {detail}
      </span>
    </li>
  );
}

export default async function StatusPage() {
  const status = await getApiStatus();
  const databaseUp = status.reachable && status.report.checks.database === 'up';

  return (
    <main className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight">System status</h1>
      <p className="mt-2 text-ink-muted">Live check of the web → API → database path.</p>
      <ul className="mt-8 divide-y divide-line rounded-card border border-line bg-surface px-6 shadow-card">
        <Row label="Web app" ok detail="Running" />
        <Row
          label="API"
          ok={status.reachable}
          detail={status.reachable ? 'Reachable' : `Unreachable — ${status.reason}`}
        />
        <Row
          label="Database"
          ok={databaseUp}
          detail={databaseUp ? 'Connected' : status.reachable ? 'Down' : 'Unknown'}
        />
      </ul>
    </main>
  );
}

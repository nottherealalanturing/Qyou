import Link from 'next/link';
import {
  describeSchedule,
  REQUEST_STATUS_COPY,
  type RequestStatus,
  type RequestView,
} from '@/lib/requests';

const TONES = {
  info: 'bg-brand-50 text-brand-700',
  success: 'bg-success/10 text-success',
  error: 'bg-danger/10 text-danger',
  neutral: 'bg-ink/5 text-ink-muted',
} as const;

export function StatusPill({ status }: { status: RequestStatus }) {
  const copy = REQUEST_STATUS_COPY[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${TONES[copy.tone]}`}
    >
      {copy.label}
    </span>
  );
}

/** The facts of a request, shared by the owner's page and a matching assistant's page. No customer data. */
export function RequestFacts({ request }: { request: RequestView }) {
  return (
    <dl className="grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
      <div>
        <dt className="font-semibold">Task</dt>
        <dd className="text-ink-muted">
          {request.task.name} <span aria-hidden="true">·</span> {request.task.category.name}
        </dd>
      </div>
      <div>
        <dt className="font-semibold">Where</dt>
        <dd className="text-ink-muted">
          {request.location ? `${request.location.name}, ${request.location.address}, ` : ''}
          {request.city.name}
        </dd>
      </div>
      <div>
        <dt className="font-semibold">When</dt>
        <dd className="text-ink-muted">{describeSchedule(request.schedule)}</dd>
      </div>
      {request.authorization.required ? (
        <div>
          <dt className="font-semibold">Authorization</dt>
          <dd className="text-ink-muted">
            {request.authorization.confirmed
              ? 'The customer will provide it to the chosen assistant. '
              : ''}
            {request.authorization.notes}
          </dd>
        </div>
      ) : null}
      <div className="sm:col-span-2">
        <dt className="font-semibold">Details</dt>
        <dd className="mt-1 whitespace-pre-line text-ink-muted">{request.description}</dd>
      </div>
      {request.constraints ? (
        <div className="sm:col-span-2">
          <dt className="font-semibold">Constraints</dt>
          <dd className="mt-1 whitespace-pre-line text-ink-muted">{request.constraints}</dd>
        </div>
      ) : null}
    </dl>
  );
}

export function RequestRow({ request, href }: { request: RequestView; href: string }) {
  return (
    <Link
      href={href}
      className="block rounded-card border border-line bg-surface p-5 shadow-card transition hover:-translate-y-0.5 hover:shadow-lg"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-semibold tracking-tight">{request.task.name}</h3>
        <StatusPill status={request.status} />
      </div>
      <p className="mt-1 text-sm text-ink-muted">
        {request.location ? `${request.location.name}, ` : ''}
        {request.city.name} <span aria-hidden="true">·</span> {describeSchedule(request.schedule)}
      </p>
      <p className="mt-2 line-clamp-2 text-sm">{request.description}</p>
      {request.pendingQuoteCount > 0 && request.status !== 'CANCELLED' ? (
        <p className="mt-3 text-sm font-semibold text-brand-700">
          {request.pendingQuoteCount} {request.pendingQuoteCount === 1 ? 'quote' : 'quotes'} waiting
        </p>
      ) : null}
    </Link>
  );
}

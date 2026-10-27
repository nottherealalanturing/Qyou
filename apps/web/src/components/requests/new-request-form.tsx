'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { CatalogTree } from '@/lib/catalog-tree';
import type { EffectiveTask, Eligibility } from '@/lib/catalog';
import { PERIOD_LABEL, type OwnRequestDetail, type TimePeriod } from '@/lib/requests';
import { Alert } from '../ui/alert';
import { Button } from '../ui/button';
import { useApiAction } from '../assistant/use-api-action';

export interface VenueForForm {
  id: string;
  name: string;
  address: string;
  city: { slug: string; name: string; state: string };
  category: { slug: string; name: string };
  tasks: EffectiveTask[];
}

interface TaskChoice {
  id: string;
  name: string;
  eligibility: Eligibility;
  authorizationNotes: string | null;
  venueNotes: string[];
}

const control = 'h-12 w-full rounded-xl border bg-surface px-4 text-base';
const border = (error?: string) => (error ? 'border-danger' : 'border-ink/25');

function FieldError({ message }: { message: string | undefined }) {
  return message ? (
    <p className="mt-1.5 flex items-start gap-1.5 text-sm font-medium text-danger">
      <span aria-hidden="true">▲</span>
      <span>{message}</span>
    </p>
  ) : null;
}

/**
 * Post a request. The API re-validates everything (task delegable, venue consistent, contact details,
 * dates); this form only guides. The authorization checkbox appears exactly when the chosen task (as
 * it applies at this venue) needs the customer's authorization.
 */
export function NewRequestForm({
  catalog,
  venue,
  today,
  initial,
}: {
  catalog: CatalogTree;
  venue: VenueForForm | null;
  today: string;
  initial: { taskId?: string | undefined; cityId?: string | undefined };
}) {
  const router = useRouter();
  const { run, pending, error, fieldErrors } = useApiAction();

  const groups: { label: string; tasks: TaskChoice[] }[] = venue
    ? [
        {
          label: venue.category.name,
          tasks: venue.tasks
            .filter((t) => t.effectiveEligibility !== 'NOT_DELEGABLE')
            .map((t) => ({
              id: t.id,
              name: t.name,
              eligibility: t.effectiveEligibility,
              authorizationNotes:
                t.authorizationNotes ??
                t.venueNotes.find((n) => n.rule === 'REQUIRES_AUTHORIZATION')?.note ??
                null,
              venueNotes: t.venueNotes.map((n) => n.note),
            })),
        },
      ]
    : catalog.categories.map(({ category, tasks }) => ({
        label: category.name,
        tasks: tasks
          .filter((t) => t.eligibility !== 'NOT_DELEGABLE')
          .map((t) => ({
            id: t.id,
            name: t.name,
            eligibility: t.eligibility,
            authorizationNotes: t.authorizationNotes,
            venueNotes: [],
          })),
      }));
  const allTasks = groups.flatMap((g) => g.tasks);

  const [taskId, setTaskId] = useState(
    allTasks.some((t) => t.id === initial.taskId) ? (initial.taskId ?? '') : '',
  );
  const [cityId, setCityId] = useState(
    catalog.cities.some((c) => c.id === initial.cityId) ? (initial.cityId ?? '') : '',
  );
  const [description, setDescription] = useState('');
  const [constraints, setConstraints] = useState('');
  const [kind, setKind] = useState<'FLEXIBLE' | 'ON_DATE'>('FLEXIBLE');
  const [date, setDate] = useState('');
  const [period, setPeriod] = useState<TimePeriod>('ANY');
  const [confirms, setConfirms] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const task = allTasks.find((t) => t.id === taskId);
  const needsAuthorization = task?.eligibility === 'REQUIRES_AUTHORIZATION';

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLocalError(null);
    if (!taskId) return setLocalError('Choose what you need done.');
    if (!venue && !cityId) return setLocalError('Choose a city.');
    const res = await run<OwnRequestDetail>('POST', '/api/v1/service-requests', {
      taskId,
      ...(venue ? { locationId: venue.id } : { cityId }),
      description,
      ...(constraints.trim() ? { constraints } : {}),
      schedule: kind === 'FLEXIBLE' ? { kind } : { kind, date, period },
      ...(needsAuthorization ? { confirmsAuthorization: confirms } : {}),
    });
    if (res.ok) router.push(`/requests/${res.data.request.id}`);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      {venue ? (
        <div className="rounded-xl border border-line bg-canvas p-4 text-sm">
          <p className="font-semibold">{venue.name}</p>
          <p className="text-ink-muted">
            {venue.address}, {venue.city.name}
          </p>
        </div>
      ) : (
        <div>
          <label htmlFor="city" className="mb-1.5 block text-sm font-semibold">
            City
          </label>
          <select
            id="city"
            value={cityId}
            onChange={(e) => setCityId(e.target.value)}
            aria-invalid={fieldErrors.cityId ? true : undefined}
            className={`${control} ${border(fieldErrors.cityId)}`}
          >
            <option value="">Choose a city</option>
            {catalog.cities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <FieldError message={fieldErrors.cityId} />
        </div>
      )}

      <div>
        <label htmlFor="task" className="mb-1.5 block text-sm font-semibold">
          What do you need done?
        </label>
        <select
          id="task"
          value={taskId}
          onChange={(e) => {
            setTaskId(e.target.value);
            setConfirms(false);
          }}
          aria-invalid={fieldErrors.taskId ? true : undefined}
          className={`${control} ${border(fieldErrors.taskId)}`}
        >
          <option value="">Choose a task</option>
          {groups.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.tasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <FieldError message={fieldErrors.taskId ?? fieldErrors.locationId} />
        {task?.venueNotes.length ? (
          <ul className="mt-2 list-disc pl-5 text-sm text-ink-muted">
            {task.venueNotes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        ) : null}
      </div>

      {needsAuthorization ? (
        <div className="rounded-xl border border-line bg-canvas p-4">
          <p className="text-sm font-semibold">This task needs your authorization</p>
          {task?.authorizationNotes ? (
            <p className="mt-1 text-sm text-ink-muted">{task.authorizationNotes}</p>
          ) : null}
          <label className="mt-3 flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={confirms}
              onChange={(e) => setConfirms(e.target.checked)}
              className="mt-1 h-4 w-4"
            />
            <span>I will provide this authorization to the assistant I choose.</span>
          </label>
          <FieldError message={fieldErrors.confirmsAuthorization} />
        </div>
      ) : null}

      <div>
        <label htmlFor="description" className="mb-1.5 block text-sm font-semibold">
          Describe the job
        </label>
        <textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={1000}
          rows={5}
          aria-invalid={fieldErrors.description ? true : undefined}
          aria-describedby="description-hint"
          className={`w-full rounded-xl border bg-surface p-4 text-base ${border(fieldErrors.description)}`}
        />
        <p id="description-hint" className="mt-1.5 text-sm text-ink-muted">
          Only assistants who match this request can read this. Don’t include phone numbers, email
          addresses, links or ID numbers: Qyou keeps contact details private.
        </p>
        <FieldError message={fieldErrors.description} />
      </div>

      <div>
        <label htmlFor="constraints" className="mb-1.5 block text-sm font-semibold">
          Anything the assistant must know or avoid? <span className="font-normal">(optional)</span>
        </label>
        <textarea
          id="constraints"
          value={constraints}
          onChange={(e) => setConstraints(e.target.value)}
          maxLength={500}
          rows={3}
          aria-invalid={fieldErrors.constraints ? true : undefined}
          className={`w-full rounded-xl border bg-surface p-4 text-base ${border(fieldErrors.constraints)}`}
        />
        <FieldError message={fieldErrors.constraints} />
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-semibold">When?</legend>
        <div className="flex flex-wrap gap-3">
          {(
            [
              ['FLEXIBLE', 'Flexible (next two weeks)'],
              ['ON_DATE', 'On a specific day'],
            ] as const
          ).map(([value, label]) => (
            <label
              key={value}
              className={`cursor-pointer rounded-full border px-4 py-2 text-sm font-medium ${kind === value ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-ink/25'}`}
            >
              <input
                type="radio"
                name="kind"
                className="sr-only"
                checked={kind === value}
                onChange={() => setKind(value)}
              />
              {label}
            </label>
          ))}
        </div>
        {kind === 'ON_DATE' ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="date" className="mb-1.5 block text-sm font-semibold">
                Day
              </label>
              <input
                id="date"
                type="date"
                value={date}
                min={today}
                onChange={(e) => setDate(e.target.value)}
                aria-invalid={fieldErrors['schedule.date'] ? true : undefined}
                className={`${control} ${border(fieldErrors['schedule.date'])}`}
              />
              <FieldError message={fieldErrors['schedule.date']} />
            </div>
            <div>
              <label htmlFor="period" className="mb-1.5 block text-sm font-semibold">
                Time of day
              </label>
              <select
                id="period"
                value={period}
                onChange={(e) => setPeriod(e.target.value as TimePeriod)}
                className={`${control} border-ink/25`}
              >
                {(Object.keys(PERIOD_LABEL) as TimePeriod[]).map((p) => (
                  <option key={p} value={p}>
                    {PERIOD_LABEL[p]}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : null}
      </fieldset>

      {localError ? <Alert tone="error">{localError}</Alert> : null}
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Alert tone="info">
        Posting a request is free and nothing is charged. Assistants will send quotes and you choose
        one. Payment isn’t available yet.
      </Alert>
      <Button type="submit" loading={pending}>
        {pending ? 'Posting…' : 'Post request'}
      </Button>
    </form>
  );
}

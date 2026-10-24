'use client';

import { useState, type FormEvent } from 'react';
import {
  DAY_NAMES,
  daysToWindows,
  windowsToDays,
  type DayWindows,
  type OwnDashboard,
} from '@/lib/assistants';
import { Alert } from '../ui/alert';
import { Button } from '../ui/button';
import { useApiAction } from './use-api-action';

const timeInput =
  'h-10 rounded-lg border border-ink/25 bg-surface px-2 text-sm disabled:opacity-60';

export function AvailabilityForm({
  current,
  locked,
}: {
  current: NonNullable<OwnDashboard['availability']>;
  locked: boolean;
}) {
  const { run, pending, error, fieldErrors, notice } = useApiAction();
  const [days, setDays] = useState<DayWindows>(windowsToDays(current.windows));
  const [note, setNote] = useState(current.note ?? '');

  const update = (day: number, index: number, key: 'start' | 'end', value: string) =>
    setDays((d) => ({
      ...d,
      [day]: (d[day] ?? []).map((w, i) => (i === index ? { ...w, [key]: value } : w)),
    }));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    await run(
      'PUT',
      '/api/v1/assistants/me/availability',
      { windows: daysToWindows(days), note: note.trim() === '' ? null : note.trim() },
      { success: 'Availability saved.' },
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <p className="rounded-xl bg-canvas p-3 text-sm text-ink-muted">{current.disclaimer}</p>
      <ul className="space-y-3">
        {DAY_NAMES.map((name, day) => (
          <li key={name} className="rounded-xl border border-line p-3">
            <div className="flex items-center justify-between">
              <span className="font-medium">{name}</span>
              <button
                type="button"
                disabled={locked}
                onClick={() =>
                  setDays((d) => ({
                    ...d,
                    [day]: [...(d[day] ?? []), { start: '08:00', end: '12:00' }],
                  }))
                }
                className="text-sm font-semibold text-brand-700 underline underline-offset-2 disabled:opacity-50"
              >
                Add time
              </button>
            </div>
            {(days[day] ?? []).length === 0 ? (
              <p className="mt-1 text-sm text-ink-muted">Not available</p>
            ) : null}
            <ul className="mt-2 space-y-2">
              {(days[day] ?? []).map((w, index) => (
                <li key={index} className="flex flex-wrap items-center gap-2">
                  <label className="sr-only" htmlFor={`s-${day}-${index}`}>
                    {name} start time
                  </label>
                  <input
                    id={`s-${day}-${index}`}
                    type="time"
                    className={timeInput}
                    value={w.start}
                    disabled={locked}
                    onChange={(e) => update(day, index, 'start', e.target.value)}
                  />
                  <span aria-hidden="true">to</span>
                  <label className="sr-only" htmlFor={`e-${day}-${index}`}>
                    {name} end time
                  </label>
                  <input
                    id={`e-${day}-${index}`}
                    type="time"
                    className={timeInput}
                    value={w.end}
                    disabled={locked}
                    onChange={(e) => update(day, index, 'end', e.target.value)}
                  />
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() =>
                      setDays((d) => ({
                        ...d,
                        [day]: (d[day] ?? []).filter((_, i) => i !== index),
                      }))
                    }
                    className="text-sm text-danger underline underline-offset-2 disabled:opacity-50"
                  >
                    Remove
                    <span className="sr-only">
                      {' '}
                      {name} window {index + 1}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <div>
        <label htmlFor="avail-note" className="mb-1.5 block text-sm font-semibold">
          Note (public)
        </label>
        <input
          id="avail-note"
          value={note}
          maxLength={200}
          disabled={locked}
          onChange={(e) => setNote(e.target.value)}
          className="h-12 w-full rounded-xl border border-ink/25 bg-surface px-4"
        />
      </div>
      {fieldErrors.windows ? <Alert tone="error">{fieldErrors.windows}</Alert> : null}
      {error ? <Alert tone="error">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      <Button type="submit" loading={pending} disabled={locked}>
        {pending ? 'Saving…' : 'Save availability'}
      </Button>
    </form>
  );
}

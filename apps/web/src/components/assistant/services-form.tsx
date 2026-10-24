'use client';

import { useState, type FormEvent } from 'react';
import type { Category, City, Task } from '@/lib/catalog';
import type { OwnDashboard } from '@/lib/assistants';
import { Alert } from '../ui/alert';
import { Button } from '../ui/button';
import { EligibilityBadge } from '../catalog/eligibility-badge';
import { useApiAction } from './use-api-action';

const toggle = (list: string[], set: (v: string[]) => void, id: string) =>
  set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

export interface CatalogForForm {
  cities: City[];
  categories: { category: Category; tasks: Task[] }[];
}

export function ServicesForm({
  catalog,
  current,
  locked,
}: {
  catalog: CatalogForForm;
  current: NonNullable<OwnDashboard['services']>;
  locked: boolean;
}) {
  const { run, pending, error, fieldErrors, notice } = useApiAction();
  const [cityIds, setCityIds] = useState<string[]>(current.cities.map((c) => c.id));
  const [taskIds, setTaskIds] = useState<string[]>(
    current.tasks.filter((t) => t.stillOffered).map((t) => t.id),
  );

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    await run(
      'PUT',
      '/api/v1/assistants/me/services',
      { cityIds, taskIds },
      { success: 'Services saved.' },
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <fieldset disabled={locked}>
        <legend className="mb-2 text-sm font-semibold">Cities you serve</legend>
        <div className="flex flex-wrap gap-2">
          {catalog.cities.map((city) => {
            const checked = cityIds.includes(city.id);
            return (
              <label
                key={city.id}
                className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium ${checked ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-ink/25'}`}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={checked}
                  onChange={() => toggle(cityIds, setCityIds, city.id)}
                />
                {checked ? <span aria-hidden="true">✓</span> : null}
                {city.name}
              </label>
            );
          })}
        </div>
        {fieldErrors.cityIds ? (
          <p className="mt-1 text-sm font-medium text-danger">▲ {fieldErrors.cityIds}</p>
        ) : null}
      </fieldset>

      <div className="space-y-5">
        <p className="text-sm font-semibold">Tasks you offer</p>
        <p className="text-sm text-ink-muted">
          Tasks that must be done in person, or with the customer’s credentials, can’t be offered on
          Qyou.
        </p>
        {catalog.categories.map(({ category, tasks }) => (
          <fieldset key={category.id} disabled={locked}>
            <legend className="text-sm font-semibold text-brand-700">{category.name}</legend>
            <ul className="mt-2 space-y-2">
              {tasks.map((task) => {
                const blocked = task.eligibility === 'NOT_DELEGABLE';
                const checked = taskIds.includes(task.id);
                return (
                  <li key={task.id}>
                    <label
                      className={`flex items-start gap-3 rounded-xl border p-3 text-sm ${blocked ? 'cursor-not-allowed border-line bg-canvas opacity-70' : 'cursor-pointer border-ink/20'} ${checked ? 'border-brand-600 bg-brand-50' : ''}`}
                    >
                      <input
                        type="checkbox"
                        className="mt-1"
                        disabled={blocked || locked}
                        checked={checked}
                        onChange={() => toggle(taskIds, setTaskIds, task.id)}
                      />
                      <span className="flex-1">
                        <span className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium">{task.name}</span>
                          <EligibilityBadge eligibility={task.eligibility} />
                        </span>
                        {blocked ? (
                          <span className="mt-1 block text-ink-muted">
                            Can’t be offered: {task.restrictionNotes}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        ))}
        {fieldErrors.taskIds ? (
          <p className="text-sm font-medium text-danger">▲ {fieldErrors.taskIds}</p>
        ) : null}
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      <Button type="submit" loading={pending} disabled={locked}>
        {pending ? 'Saving…' : 'Save services'}
      </Button>
    </form>
  );
}

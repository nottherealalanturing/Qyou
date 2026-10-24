'use client';

import { useState, type FormEvent } from 'react';
import type { AdminDetail } from '@/lib/assistants';
import { Alert } from '../ui/alert';
import { Button } from '../ui/button';
import { useApiAction } from './use-api-action';

const TRANSITION_LABEL: Record<string, string> = {
  UNDER_REVIEW: 'Start review / reconsider',
  CHANGES_REQUESTED: 'Request changes',
  APPROVED: 'Approve (grants the assistant role)',
  REJECTED: 'Reject',
  SUSPENDED: 'Suspend (revokes the assistant role)',
};

const area = 'w-full rounded-xl border border-ink/25 bg-surface p-3 text-sm';

export function IdentityCheckForm({ id }: { id: string }) {
  const { run, pending, error, fieldErrors, notice } = useApiAction();
  const [result, setResult] = useState<'PASSED' | 'FAILED' | 'INCONCLUSIVE'>('PASSED');
  const [evidenceRef, setEvidenceRef] = useState('');
  const [notes, setNotes] = useState('');

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const res = await run(
      'POST',
      `/api/v1/admin/assistants/${id}/identity-checks`,
      {
        result,
        evidenceRef: evidenceRef.trim() || null,
        notes: notes.trim() || null,
      },
      { success: 'Outcome recorded.' },
    );
    if (res.ok) {
      setEvidenceRef('');
      setNotes('');
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Alert tone="info">
        Record only the <strong>outcome</strong> of your manual review. Qyou stores no documents,
        photos or ID numbers: keep evidence in your own secure system and enter only an opaque
        reference to it. ID, card or phone numbers are rejected.
      </Alert>
      <fieldset>
        <legend className="mb-2 text-sm font-semibold">Outcome</legend>
        <div className="flex flex-wrap gap-2">
          {(['PASSED', 'FAILED', 'INCONCLUSIVE'] as const).map((value) => (
            <label
              key={value}
              className={`cursor-pointer rounded-full border px-4 py-2 text-sm font-medium ${result === value ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-ink/25'}`}
            >
              <input
                type="radio"
                name="result"
                className="sr-only"
                checked={result === value}
                onChange={() => setResult(value)}
              />
              {value.charAt(0) + value.slice(1).toLowerCase()}
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label htmlFor="evidence-ref" className="mb-1 block text-sm font-semibold">
          Evidence reference (optional)
        </label>
        <input
          id="evidence-ref"
          value={evidenceRef}
          maxLength={120}
          onChange={(e) => setEvidenceRef(e.target.value)}
          placeholder="e.g. VID-2026-1042"
          className="h-11 w-full rounded-xl border border-ink/25 bg-surface px-3 text-sm"
        />
        {fieldErrors.evidenceRef ? (
          <p className="mt-1 text-sm font-medium text-danger">▲ {fieldErrors.evidenceRef}</p>
        ) : null}
      </div>
      <div>
        <label htmlFor="id-notes" className="mb-1 block text-sm font-semibold">
          Notes (optional, no ID numbers)
        </label>
        <textarea
          id="id-notes"
          value={notes}
          maxLength={500}
          rows={3}
          onChange={(e) => setNotes(e.target.value)}
          className={area}
        />
        {fieldErrors.notes ? (
          <p className="mt-1 text-sm font-medium text-danger">▲ {fieldErrors.notes}</p>
        ) : null}
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      <Button type="submit" loading={pending}>
        {pending ? 'Recording…' : 'Record outcome'}
      </Button>
    </form>
  );
}

export function TransitionForm({
  id,
  status,
  allowed,
  requirementsKey = '',
}: {
  id: string;
  status: AdminDetail['status'];
  allowed: AdminDetail['allowedTransitions'];
  /** Changes whenever the server-rendered approval requirements change, so old blockers don't linger. */
  requirementsKey?: string;
}) {
  const { run, pending, error, fieldErrors } = useApiAction();
  const [to, setTo] = useState<string>(allowed[0] ?? '');
  const [reason, setReason] = useState('');
  // Blockers belong to the requirements they were computed against; derive instead of syncing via an effect.
  const [blockerState, setBlockerState] = useState<{ key: string; items: string[] }>({
    key: requirementsKey,
    items: [],
  });
  const blockers = blockerState.key === requirementsKey ? blockerState.items : [];
  const [done, setDone] = useState<string | null>(null);

  if (allowed.length === 0)
    return (
      <p className="text-sm text-ink-muted">
        No decision is available for this application in its current status.
      </p>
    );
  // Starting a review needs no reason; every other decision (including reconsidering a rejection) does.
  const needsReason = !(status === 'SUBMITTED' && to === 'UNDER_REVIEW');

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBlockerState({ key: requirementsKey, items: [] });
    setDone(null);
    const res = await run('POST', `/api/v1/admin/assistants/${id}/transitions`, {
      to,
      ...(reason.trim() ? { reason: reason.trim() } : {}),
    });
    if (res.ok) {
      setReason('');
      setDone('Decision recorded and audited.');
    } else {
      setBlockerState({ key: requirementsKey, items: res.blockers });
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label htmlFor="decision" className="mb-1 block text-sm font-semibold">
          Decision
        </label>
        <select
          id="decision"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="h-11 w-full rounded-xl border border-ink/25 bg-surface px-3 text-sm"
        >
          {allowed.map((value) => (
            <option key={value} value={value}>
              {TRANSITION_LABEL[value] ?? value}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="reason" className="mb-1 block text-sm font-semibold">
          Reason{' '}
          {needsReason
            ? '(required, at least 10 characters; shown to the applicant)'
            : '(optional)'}
        </label>
        <textarea
          id="reason"
          value={reason}
          maxLength={500}
          rows={3}
          onChange={(e) => setReason(e.target.value)}
          aria-invalid={fieldErrors.reason ? true : undefined}
          className={area}
        />
        {fieldErrors.reason ? (
          <p className="mt-1 text-sm font-medium text-danger">▲ {fieldErrors.reason}</p>
        ) : null}
      </div>
      {blockers.length > 0 ? (
        <Alert tone="error">
          <p className="font-semibold">Cannot approve yet:</p>
          <ul className="list-disc pl-5 font-normal">
            {blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
      {error && blockers.length === 0 ? <Alert tone="error">{error}</Alert> : null}
      {done ? <Alert tone="success">{done}</Alert> : null}
      <Button
        type="submit"
        loading={pending}
        variant={to === 'REJECTED' || to === 'SUSPENDED' ? 'secondary' : 'primary'}
      >
        {pending ? 'Saving…' : 'Record decision'}
      </Button>
    </form>
  );
}

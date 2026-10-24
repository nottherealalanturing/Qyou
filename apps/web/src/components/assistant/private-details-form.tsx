'use client';

import { useState, type FormEvent } from 'react';
import type { OwnDashboard } from '@/lib/assistants';
import { Alert } from '../ui/alert';
import { Button } from '../ui/button';
import { TextField } from '../ui/text-field';
import { useApiAction } from './use-api-action';

/** Legal name and mobile number are PRIVATE: only Qyou reviewers see them. The phone is verified with a one-time code. */
export function PrivateDetailsForm({
  details,
  editScope,
  canVerifyPhone,
}: {
  details: NonNullable<OwnDashboard['private']>;
  editScope: 'full' | 'limited' | 'none';
  canVerifyPhone: boolean;
}) {
  const save = useApiAction();
  const send = useApiAction();
  const verify = useApiAction();
  const [code, setCode] = useState('');
  const [sentNote, setSentNote] = useState<string | null>(null);

  async function onSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const payload: Record<string, string> = { phone: String(data.get('phone') ?? '') };
    if (editScope === 'full') payload.legalName = String(data.get('legalName') ?? '');
    await save.run('PUT', '/api/v1/assistants/me/private', payload, { success: 'Details saved.' });
  }

  async function onSend() {
    const result = await send.run<{ status: string; transport: string }>(
      'POST',
      '/api/v1/assistants/me/phone/code',
      {},
      { refresh: true },
    );
    if (result.ok && result.data.status === 'sent') {
      setSentNote(
        result.data.transport === 'simulated-dev'
          ? 'Development mode: no SMS was sent. Open the Mailpit inbox (localhost:8052) to read the simulated message.'
          : 'We sent a 6-digit code to your number. It expires in 10 minutes.',
      );
    }
  }

  async function onVerify(event: FormEvent) {
    event.preventDefault();
    const result = await verify.run('POST', '/api/v1/assistants/me/phone/verify', {
      code: code.trim(),
    });
    if (result.ok) {
      setCode('');
      setSentNote(null);
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={onSave} noValidate className="space-y-5">
        <p className="rounded-xl bg-canvas p-3 text-sm text-ink-muted">
          <strong className="text-ink">Private.</strong> Your legal name and number are never shown
          on your profile. Only the Qyou team reviewing your application can see them.
        </p>
        <TextField
          label="Legal name"
          name="legalName"
          defaultValue={details.legalName ?? ''}
          disabled={editScope !== 'full'}
          error={save.fieldErrors.legalName}
          hint="As it appears on your ID."
        />
        <TextField
          label="Mobile number"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          defaultValue={details.phone ?? ''}
          disabled={editScope === 'none'}
          error={save.fieldErrors.phone}
          hint="Nigerian mobile numbers only, e.g. 0803 123 4567. Changing it means verifying again."
        />
        {save.error ? <Alert tone="error">{save.error}</Alert> : null}
        {save.notice ? <Alert tone="success">{save.notice}</Alert> : null}
        <Button type="submit" loading={save.pending} disabled={editScope === 'none'}>
          {save.pending ? 'Saving…' : 'Save details'}
        </Button>
      </form>

      <div className="border-t border-line pt-6">
        <h3 className="font-semibold">Verify your mobile number</h3>
        {details.phoneVerified ? (
          <p className="mt-2 flex items-center gap-2 font-medium text-success">
            <span aria-hidden="true">✓</span> Number verified
          </p>
        ) : !details.phone ? (
          <p className="mt-2 text-sm text-ink-muted">Save your mobile number first.</p>
        ) : !canVerifyPhone ? (
          <p className="mt-2 text-sm text-ink-muted">
            Phone verification isn’t available for this application.
          </p>
        ) : (
          <div className="mt-3 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="secondary" loading={send.pending} onClick={onSend}>
                {send.pending ? 'Sending…' : 'Send me a code'}
              </Button>
              <span className="text-sm text-ink-muted">to {details.phone}</span>
            </div>
            {send.error ? <Alert tone="error">{send.error}</Alert> : null}
            {sentNote ? <Alert tone="info">{sentNote}</Alert> : null}
            <form onSubmit={onVerify} noValidate className="flex flex-wrap items-end gap-3">
              <div className="w-48">
                <TextField
                  label="6-digit code"
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  error={verify.fieldErrors.code}
                />
              </div>
              <Button type="submit" loading={verify.pending} disabled={code.length !== 6}>
                {verify.pending ? 'Checking…' : 'Verify'}
              </Button>
            </form>
            {verify.error ? <Alert tone="error">{verify.error}</Alert> : null}
          </div>
        )}
      </div>
    </div>
  );
}

import { STATUS_COPY, type ApplicationStatus } from '@/lib/assistants';
import { Alert } from '../ui/alert';

export function StatusBanner({
  status,
  reason,
}: {
  status: ApplicationStatus;
  reason: string | null;
}) {
  const copy = STATUS_COPY[status];
  return (
    <Alert tone={copy.tone}>
      <p className="font-semibold">{copy.title}</p>
      <p className="font-normal">{copy.body}</p>
      {reason ? (
        <p className="mt-2 font-normal">
          <strong>Message from Qyou: </strong>
          {reason}
        </p>
      ) : null}
    </Alert>
  );
}

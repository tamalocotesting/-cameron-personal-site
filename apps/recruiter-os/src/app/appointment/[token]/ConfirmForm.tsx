'use client';
import { useState } from 'react';
import { Button, Notice } from '@/components/ui';
import { confirmAppointmentAction } from '@/server/actions/appointment-actions';

export function ConfirmForm({ token, alreadyConfirmed }: { token: string; alreadyConfirmed: boolean }) {
  const [result, setResult] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (result) return <Notice tone="ready">{result}</Notice>;

  return (
    <div className="space-y-2">
      {alreadyConfirmed ? <Notice tone="ready">You have already confirmed this time.</Notice> : null}
      <Button
        variant="primary"
        className="w-full"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          const response = await confirmAppointmentAction(token, 'confirm');
          setPending(false);
          setResult(response.message);
        }}
      >
        {pending ? 'Saving…' : 'Yes, that time works'}
      </Button>
      <Button
        variant="secondary"
        className="w-full"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          const response = await confirmAppointmentAction(token, 'decline');
          setPending(false);
          setResult(response.message);
        }}
      >
        {pending ? 'Saving…' : 'That time does not work'}
      </Button>
    </div>
  );
}

'use client';
import { useRouter } from 'next/navigation';
import { Field, Input, Notice } from '@/components/ui';
import { ActionForm } from '@/components/ui/form';
import { verifyResumeAction } from '@/server/actions/intake-actions';

/**
 * The additional verification step before previously submitted answers are
 * shown on a new device. Attempts are counted on the session row, so closing
 * the browser does not reset them.
 */
export function VerifyForm() {
  const router = useRouter();
  return (
    <div className="space-y-3">
      <Notice tone="neutral">
        Your link is valid, so you can carry on answering. Before we show what you already sent, enter
        the last four digits of the phone number you gave us — or the code the recruiter read out.
      </Notice>
      <ActionForm action={verifyResumeAction} submitLabel="Continue" onSuccess={() => router.refresh()}>
        <Field label="Last four digits, or your code" htmlFor="verify-answer" required>
          <Input id="verify-answer" name="answer" inputMode="numeric" autoComplete="off" required />
        </Field>
      </ActionForm>
    </div>
  );
}

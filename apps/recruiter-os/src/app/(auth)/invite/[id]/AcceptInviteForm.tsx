'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Field, Input, Notice } from '@/components/ui';
import { authClient } from '@/lib/auth-client';

export function AcceptInviteForm({ invitationId, email }: { invitationId: string; email: string }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <form
      className="space-y-3"
      onSubmit={async (event) => {
        event.preventDefault();
        setError(null);
        if (password.length < 12) {
          setError('Use at least 12 characters.');
          return;
        }
        setPending(true);
        try {
          // The invitation itself is the authorization to create this account.
          const created = await authClient.signUp.email({ email, password, name });
          if (created.error && !/exists/i.test(created.error.message ?? '')) {
            setError(created.error.message ?? 'That did not work.');
            return;
          }
          if (created.error) {
            const signedIn = await authClient.signIn.email({ email, password });
            if (signedIn.error) {
              setError('An account already exists for this address. Sign in, then open the invitation again.');
              return;
            }
          }
          const accepted = await authClient.organization.acceptInvitation({ invitationId });
          if (accepted.error) {
            setError(accepted.error.message ?? 'The invitation could not be accepted.');
            return;
          }
          router.push('/today');
          router.refresh();
        } finally {
          setPending(false);
        }
      }}
    >
      <Field label="Your name" htmlFor="invite-name" required>
        <Input
          id="invite-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          required
        />
      </Field>
      <Field label="Password" htmlFor="invite-password" required hint="At least 12 characters.">
        <Input
          id="invite-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </Field>
      {error ? <Notice tone="review">{error}</Notice> : null}
      <Button type="submit" variant="primary" disabled={pending} className="w-full">
        {pending ? 'Joining…' : 'Accept invitation'}
      </Button>
    </form>
  );
}

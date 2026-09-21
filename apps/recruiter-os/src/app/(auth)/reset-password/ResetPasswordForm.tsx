'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Field, Input, Notice } from '@/components/ui';
import { authClient } from '@/lib/auth-client';

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
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
        if (password !== confirm) {
          setError('Those two passwords do not match.');
          return;
        }
        setPending(true);
        const result = await authClient.resetPassword({ newPassword: password, token });
        setPending(false);
        if (result.error) {
          setError('That reset link is no longer valid. Request a new one.');
          return;
        }
        router.push('/login');
      }}
    >
      <Field label="New password" htmlFor="new-password" required>
        <Input
          id="new-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </Field>
      <Field label="Confirm new password" htmlFor="confirm-password" required>
        <Input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />
      </Field>
      {error ? <Notice tone="review">{error}</Notice> : null}
      <Button type="submit" variant="primary" disabled={pending} className="w-full">
        {pending ? 'Saving…' : 'Set new password'}
      </Button>
    </form>
  );
}

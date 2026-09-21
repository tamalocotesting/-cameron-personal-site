'use client';
import { useState } from 'react';
import { Button, Field, Input, Notice } from '@/components/ui';
import { authClient } from '@/lib/auth-client';
import { env } from 'process';

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  void env;

  if (sent) {
    return (
      <Notice tone="ready">
        If that address has an account, a reset link is on its way. The link expires in one hour.
      </Notice>
    );
  }

  return (
    <form
      className="space-y-3"
      onSubmit={async (event) => {
        event.preventDefault();
        setPending(true);
        // The response is the same either way: this endpoint must not reveal
        // whether an account exists.
        await authClient.requestPasswordReset({ email, redirectTo: '/reset-password' });
        setPending(false);
        setSent(true);
      }}
    >
      <Field label="Email address" htmlFor="reset-email" required>
        <Input
          id="reset-email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </Field>
      <Button type="submit" variant="primary" disabled={pending} className="w-full">
        {pending ? 'Sending…' : 'Send reset link'}
      </Button>
    </form>
  );
}

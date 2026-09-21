'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { Button, Field, Input, Notice } from '@/components/ui';

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [needsTotp, setNeedsTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      if (needsTotp) {
        const result = await authClient.twoFactor.verifyTotp({ code: totp });
        if (result.error) {
          setError(result.error.message ?? 'That code was not accepted.');
          return;
        }
      } else {
        const result = await authClient.signIn.email({ email, password });
        if (result.error) {
          // Deliberately generic: this must not reveal whether an account exists.
          setError('That email address and password combination did not work.');
          return;
        }
        if ((result.data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) {
          setNeedsTotp(true);
          return;
        }
      }
      router.push('/today');
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      {needsTotp ? (
        <Field label="Authentication code" htmlFor="totp" required hint="From your authenticator app.">
          <Input
            id="totp"
            name="totp"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={totp}
            onChange={(e) => setTotp(e.target.value)}
            required
          />
        </Field>
      ) : (
        <>
          <Field label="Email address" htmlFor="email" required>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </Field>
          <Field label="Password" htmlFor="password" required>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
        </>
      )}

      {error ? (
        <Notice tone="review" icon={<AlertTriangle size={14} />}>
          {error}
        </Notice>
      ) : null}

      <Button type="submit" variant="primary" disabled={pending} className="w-full">
        {pending ? (
          <>
            <Loader2 size={14} className="animate-spin" aria-hidden="true" /> Signing in…
          </>
        ) : needsTotp ? (
          'Verify code'
        ) : (
          'Sign in'
        )}
      </Button>
    </form>
  );
}

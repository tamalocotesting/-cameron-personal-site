'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Badge, Button, Notice } from '@/components/ui';
import { authClient } from '@/lib/auth-client';

/**
 * The demo password is a fixed, publicly documented value that only exists in
 * the seeded demo organizations. It is not a production credential and cannot
 * be used against a LIVE organization, which the seed never creates.
 */
const DEMO_PASSWORD = 'demo-password-not-for-live-use';

export function DemoSignIn({
  members,
}: {
  members: Array<{ email: string; displayName: string; staffRole: string; organizationName: string }>;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!members.length) {
    return (
      <Notice tone="pending">
        No demo members are seeded yet. Run <code className="font-mono text-[12px]">pnpm seed</code>.
      </Notice>
    );
  }

  return (
    <div className="space-y-2">
      {error ? <Notice tone="review">{error}</Notice> : null}
      <ul className="divide-y divide-line rounded-md border border-line">
        {members.map((member) => (
          <li key={member.email} className="flex flex-wrap items-center gap-2 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-medium text-ink">{member.displayName}</p>
              <p className="truncate text-[12px] text-ink-faint">
                {member.email} · {member.organizationName}
              </p>
            </div>
            <Badge tone="neutral">{member.staffRole.replace('_', ' ').toLowerCase()}</Badge>
            <Button
              size="sm"
              variant="primary"
              disabled={pending !== null}
              onClick={async () => {
                setPending(member.email);
                setError(null);
                const result = await authClient.signIn.email({
                  email: member.email,
                  password: DEMO_PASSWORD,
                });
                if (result.error) {
                  setError(
                    'The seeded demo credential did not work. Re-run `pnpm seed` to recreate the demo dataset.',
                  );
                  setPending(null);
                  return;
                }
                router.push('/today');
                router.refresh();
              }}
            >
              {pending === member.email ? 'Signing in…' : 'Sign in'}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

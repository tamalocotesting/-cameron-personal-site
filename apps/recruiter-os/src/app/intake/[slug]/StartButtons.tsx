'use client';
import { useState, useTransition } from 'react';
import { Loader2, MessageSquare, PhoneCall } from 'lucide-react';
import { Button, Notice } from '@/components/ui';
import { startIntakeAction } from '@/server/actions/intake-actions';

export function StartButtons({ slug }: { slug: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const start = (pathway: 'callback' | 'full') => {
    setError(null);
    startTransition(async () => {
      try {
        await startIntakeAction(slug, pathway);
      } catch (thrown) {
        // A redirect throws by design; only report a real failure.
        if ((thrown as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw thrown;
        setError('That did not start. Please try again in a moment.');
      }
    });
  };

  return (
    <div className="space-y-2">
      <Button variant="primary" className="w-full" disabled={pending} onClick={() => start('callback')}>
        {pending ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <PhoneCall size={15} aria-hidden="true" />}
        Request a callback
      </Button>
      <Button variant="secondary" className="w-full" disabled={pending} onClick={() => start('full')}>
        {pending ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <MessageSquare size={15} aria-hidden="true" />}
        Share a little more information
      </Button>
      {error ? <Notice tone="review">{error}</Notice> : null}
    </div>
  );
}

import { redirect } from 'next/navigation';
import { exchangeResumeAction } from '@/server/actions/intake-actions';

export const dynamic = 'force-dynamic';

/**
 * The only place a resume credential is ever read.
 *
 * It is exchanged for a session cookie and the request is redirected to a URL
 * with no token in it, so the secret does not linger in the address bar,
 * browser history, a bookmark or a referrer header.
 */
export default async function ResumePage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const { t } = await searchParams;
  if (!t) redirect('/resume/unavailable?reason=missing');
  await exchangeResumeAction(t);
  return null;
}

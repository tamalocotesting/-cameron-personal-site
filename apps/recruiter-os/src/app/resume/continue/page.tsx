import { redirect } from 'next/navigation';
import { readIntakeCookies } from '@/server/actions/intake-actions';
import { loadSession } from '@/server/services/intake';

export const dynamic = 'force-dynamic';

export default async function ResumeContinuePage() {
  const { sessionId } = await readIntakeCookies();
  if (!sessionId) redirect('/resume/unavailable?reason=invalid');
  const session = await loadSession(sessionId);
  if (!session) redirect('/resume/unavailable?reason=invalid');
  redirect(`/intake/${session.organization.slug}/session`);
}

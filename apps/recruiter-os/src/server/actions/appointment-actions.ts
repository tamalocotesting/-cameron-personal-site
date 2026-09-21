'use server';
import { confirmAppointmentByToken } from '@/server/services/appointments';

/**
 * The applicant-side confirmation. Takes a credential and an intent, and can
 * do nothing else.
 */
export async function confirmAppointmentAction(
  token: string,
  action: 'confirm' | 'decline',
): Promise<{ message: string }> {
  const result = await confirmAppointmentByToken(token, action);
  if (result.status !== 'ok') {
    return { message: 'This link is no longer usable. Reply to the recruiter who contacted you.' };
  }
  return {
    message:
      action === 'confirm'
        ? 'Thank you — your appointment is confirmed. The recruiter has been told.'
        : 'Thanks for letting us know. The recruiter will be in touch about another time.',
  };
}

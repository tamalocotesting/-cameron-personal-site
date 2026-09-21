'use server';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { IntakePathway } from '@prisma/client';
import { runAction } from './helpers';
import type { ActionState } from '@/components/ui/form';
import {
  exchangeResumeToken,
  findOrganizationBySlug,
  pauseSession,
  startIntakeSession,
  submitAnswer,
  verifyResumeIdentity,
} from '@/server/services/intake';
import { env } from '@/env';
import { ConflictError, ValidationError } from '@/server/authz/errors';

/**
 * Applicant-facing actions.
 *
 * The session identifier lives in an httpOnly cookie, never in the URL: a
 * shared screenshot or a browser history entry must not hand someone else the
 * conversation. The resume credential arrives once in a query string and is
 * immediately exchanged and removed by a redirect.
 */

const SESSION_COOKIE = 'ros_intake_session';
const VERIFIED_COOKIE = 'ros_intake_verified';

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: env.PUBLIC_APP_URL.startsWith('https://'),
    path: '/',
    maxAge: 60 * 60 * 24 * 3,
  };
}

async function requestKey() {
  const requestHeaders = await headers();
  // Best-effort client identity for rate limiting only. Never stored.
  return (
    requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    requestHeaders.get('x-real-ip') ||
    'unknown'
  );
}

export async function startIntakeAction(slug: string, pathway: 'callback' | 'full') {
  const organization = await findOrganizationBySlug(slug);
  if (!organization) throw new ValidationError('That intake link is not valid.');

  const started = await startIntakeSession({
    organizationId: organization.id,
    pathway: pathway === 'callback' ? IntakePathway.CALLBACK_REQUEST : IntakePathway.FULL_INTAKE,
    requestKey: await requestKey(),
  });

  const store = await cookies();
  store.set(SESSION_COOKIE, started.sessionId, cookieOptions());
  // The applicant's own device is trusted for this session from the start;
  // a NEW device later needs the extra verification step.
  store.set(VERIFIED_COOKIE, started.sessionId, cookieOptions());
  redirect(`/intake/${slug}/session`);
}

export async function startCallbackAction() {
  const store = await cookies();
  const slug = store.get('ros_intake_slug')?.value;
  if (!slug) throw new ConflictError('Start again from the intake link.');
  await startIntakeAction(slug, 'callback');
}

export async function submitAnswerAction(_state: ActionState, data: FormData): Promise<ActionState> {
  return runAction(async () => {
    const store = await cookies();
    const sessionId = store.get(SESSION_COOKIE)?.value;
    if (!sessionId) throw new ConflictError('This conversation has expired. Open the link again.');

    const skip = data.get('skip') === 'true';
    const consentRaw = data.get('consentGranted');
    const result = await submitAnswer(
      {
        sessionId,
        questionKey: String(data.get('questionKey') ?? ''),
        valueText: typeof data.get('valueText') === 'string' ? String(data.get('valueText')) : '',
        valueOptions: data.getAll('valueOptions').filter((v): v is string => typeof v === 'string'),
        skip,
        ...(typeof consentRaw === 'string' ? { consentGranted: consentRaw === 'yes' } : {}),
      },
      { requestKey: await requestKey() },
    );

    return {
      message:
        result.status === 'handed_off'
          ? (result.message ?? 'Passed to a recruiter.')
          : result.status === 'complete'
            ? (result.message ?? 'Thank you.')
            : 'Saved.',
      revalidate: [],
    };
  });
}

export async function pauseIntakeAction(_state: ActionState, _data: FormData): Promise<ActionState> {
  return runAction(async () => {
    const store = await cookies();
    const sessionId = store.get(SESSION_COOKIE)?.value;
    if (!sessionId) throw new ConflictError('There is nothing to pause.');
    const paused = await pauseSession(sessionId);
    return {
      message: `Saved. Come back with this private link — it works for 72 hours: ${env.PUBLIC_APP_URL}/resume?t=${paused.resumeToken}`,
      revalidate: [],
    };
  });
}

export async function verifyResumeAction(_state: ActionState, data: FormData): Promise<ActionState> {
  return runAction(async () => {
    const store = await cookies();
    const sessionId = store.get(SESSION_COOKIE)?.value;
    if (!sessionId) throw new ConflictError('Open your link again.');
    const result = await verifyResumeIdentity(sessionId, String(data.get('answer') ?? ''), {
      requestKey: await requestKey(),
    });
    if (!result.ok) throw new ValidationError(result.reason ?? 'That did not match.');
    store.set(VERIFIED_COOKIE, sessionId, cookieOptions());
    return { message: 'Thanks — your earlier answers are shown again.', revalidate: [] };
  });
}

/**
 * Exchange a resume credential for a session cookie, then redirect WITHOUT the
 * token so it leaves the address bar, browser history and any referrer header.
 */
export async function exchangeResumeAction(token: string) {
  const store = await cookies();
  const result = await exchangeResumeToken(token, {
    requestKey: await requestKey(),
    hasPriorDeviceSession: false,
  });

  if (result.status !== 'ok') {
    redirect(`/resume/unavailable?reason=${result.status}`);
  }

  store.set(SESSION_COOKIE, result.sessionId, cookieOptions());
  if (!result.needsVerification) store.set(VERIFIED_COOKIE, result.sessionId, cookieOptions());
  redirect('/resume/continue');
}

export async function readIntakeCookies() {
  const store = await cookies();
  const sessionId = store.get(SESSION_COOKIE)?.value ?? null;
  const verifiedFor = store.get(VERIFIED_COOKIE)?.value ?? null;
  return { sessionId, verified: sessionId !== null && verifiedFor === sessionId };
}

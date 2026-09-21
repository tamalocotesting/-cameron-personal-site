import 'server-only';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { organization, twoFactor } from 'better-auth/plugins';
import { nextCookies } from 'better-auth/next-js';
import { prisma } from '@/server/db';
import { env } from '@/env';
import { sendStaffMail } from '@/server/mail/mailer';

/**
 * Staff authentication.
 *
 * Invitation-only: `disableSignUp` closes the public sign-up endpoint, so the
 * only route to an account is an invitation an existing administrator sent, or
 * the one-time bootstrap CLI (scripts/bootstrap-organization.ts).
 *
 * There is deliberately no default live credential anywhere in this repo.
 */
export const auth = betterAuth({
  appName: 'RecruiterOS',
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.PUBLIC_APP_URL, ...env.trustedOrigins],

  database: prismaAdapter(prisma, { provider: 'postgresql', transaction: true }),

  emailAndPassword: {
    enabled: true,
    // No open staff signup, ever.
    disableSignUp: true,
    minPasswordLength: 12,
    requireEmailVerification: false,
    sendResetPassword: async ({ user, url }) => {
      await sendStaffMail({
        to: user.email,
        subject: 'Reset your RecruiterOS password',
        text: [
          `A password reset was requested for ${user.email}.`,
          '',
          `Open this link to choose a new password: ${url}`,
          '',
          'If you did not request this, you can ignore this message. The link expires in one hour.',
        ].join('\n'),
      });
    },
    resetPasswordTokenExpiresIn: 60 * 60,
  },

  session: {
    expiresIn: 60 * 60 * 8,
    updateAge: 60 * 15,
    freshAge: 60 * 10,
    cookieCache: { enabled: false },
  },

  /**
   * Deliberate rate limiting. Sign-in, password reset and two-factor
   * verification are the endpoints worth guessing against, so they get a
   * tighter budget than the rest of the API.
   *
   * This is per-instance, like the intake limiter: behind several instances
   * the effective budget is (max x instances). SECURITY.md says so rather
   * than implying a distributed limiter.
   */
  rateLimit: {
    enabled: true,
    window: 60,
    max: 120,
    customRules: {
      '/sign-in/email': { window: 60, max: 20 },
      '/request-password-reset': { window: 60, max: 5 },
      '/reset-password': { window: 60, max: 10 },
      '/two-factor/verify-totp': { window: 60, max: 10 },
    },
  },

  advanced: {
    useSecureCookies: env.PUBLIC_APP_URL.startsWith('https://'),
    defaultCookieAttributes: { sameSite: 'lax', httpOnly: true },
  },

  user: {
    additionalFields: {},
  },

  plugins: [
    organization({
      allowUserToCreateOrganization: false,
      membershipLimit: 200,
      invitationExpiresIn: 60 * 60 * 24 * 7,
      sendInvitationEmail: async (data) => {
        const url = `${env.PUBLIC_APP_URL}/invite/${data.id}`;
        await sendStaffMail({
          to: data.email,
          subject: `You have been invited to ${data.organization.name} on RecruiterOS`,
          text: [
            `${data.inviter.user.name || data.inviter.user.email} invited you to join ${data.organization.name} on RecruiterOS.`,
            '',
            `Accept the invitation: ${url}`,
            '',
            'RecruiterOS is a recruiter workspace. AI prepares. Recruiter decides.',
            'This invitation expires in 7 days.',
          ].join('\n'),
        });
      },
    }),
    // TOTP-based MFA. Enrolment is per user, from Settings.
    twoFactor({ issuer: 'RecruiterOS' }),
    // Must stay last: it flushes Set-Cookie through Next's cookie API.
    nextCookies(),
  ],
});

export type Auth = typeof auth;

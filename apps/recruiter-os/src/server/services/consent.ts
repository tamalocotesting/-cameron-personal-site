import 'server-only';
import { ConsentAction, ContactChannel, ConsentPurpose } from '@prisma/client';
import type { DbOrTx } from '@/server/db';
import { prisma } from '@/server/db';
import { now } from '@/server/clock';
import { auditSecurity } from '@/server/audit';
import { maskContact } from '@/lib/redact';
import type { ActorContext } from '@/server/authz/policy';
import { organizationIdOf } from '@/server/authz/policy';
import { ValidationError } from '@/server/authz/errors';

/**
 * Consent and channel permission.
 *
 * The rules this file exists to keep:
 *
 *  * INBOUND_CALL_RESPONSE is the one basis a person's own action creates
 *    without them typing anything: they called the organization's published
 *    number. It authorizes ONE reply to that same number, within a configured
 *    window, and nothing else. It is not INTAKE_SMS and it is not
 *    RECRUITER_SMS — continuing by text needs the person to say yes, which is
 *    recorded separately.
 *  * Consent is recorded PER CHANNEL, PER PURPOSE, PER CONTACT VALUE, with the
 *    exact disclosure text and version the person saw, a timestamp, a source,
 *    and full revocation history.
 *  * Submitting a phone number is not consent to be texted. A missed call is
 *    not consent to be texted. Asking for a phone callback is not consent to
 *    be texted. Each of those grants exactly what it says and nothing else.
 *  * Provider suppression (a STOP keyword, or opt-out metadata from the
 *    carrier) is DURABLE and cannot be overridden by a recruiter pressing
 *    Send. Only an explicit new opt-in from the person lifts it.
 */

export const DISCLOSURES = {
  callback_call: {
    key: 'callback_call',
    version: 3,
    text:
      'We will call you at the number you gave us so a recruiter can talk with you. ' +
      'Asking for a call does not sign you up for text messages.',
  },
  inbound_call_response: {
    key: 'inbound_call_response',
    version: 1,
    text:
      'You called us and we could not pick up. Because you called, we sent you one text back at that ' +
      'same number to say so and to ask whether you would like to answer a few questions by text. ' +
      'That single reply is all this permits. Nothing else is sent unless you say yes, and you can ' +
      'reply STOP at any time.',
  },
  intake_sms: {
    key: 'intake_sms',
    version: 3,
    text:
      'You can choose to get a text with a link to finish these questions. Message and data rates may apply. ' +
      'Reply STOP at any time to stop texts. This is optional — you can ask for a phone call instead.',
  },
  recruiter_sms: {
    key: 'recruiter_sms',
    version: 3,
    text:
      'You can choose to exchange text messages with a recruiter. Message and data rates may apply. ' +
      'Reply STOP at any time to stop texts, or HELP for help.',
  },
  appointment_reminder_sms: {
    key: 'appointment_reminder_sms',
    version: 2,
    text:
      'You can choose to get a text reminder before an appointment. Reply STOP at any time to stop texts.',
  },
  email_updates: {
    key: 'email_updates',
    version: 2,
    text: 'You can choose to get email updates about your conversation with a recruiter.',
  },
} as const;

export type DisclosureKey = keyof typeof DISCLOSURES;

const PURPOSE_CHANNEL: Record<ConsentPurpose, ContactChannel> = {
  CALLBACK_CALL: ContactChannel.PHONE_CALL,
  INBOUND_CALL_RESPONSE: ContactChannel.SMS,
  INTAKE_SMS: ContactChannel.SMS,
  APPOINTMENT_REMINDER_SMS: ContactChannel.SMS,
  RECRUITER_SMS: ContactChannel.SMS,
  EMAIL_UPDATES: ContactChannel.EMAIL,
};

export function channelForPurpose(purpose: ConsentPurpose): ContactChannel {
  return PURPOSE_CHANNEL[purpose];
}

export async function recordConsent(
  db: DbOrTx,
  input: {
    organizationId: string;
    applicantId: string;
    purpose: ConsentPurpose;
    contactValue: string;
    action: ConsentAction;
    disclosure: { key: string; version: number; text: string };
    source: string;
    occurredAt?: Date;
  },
) {
  const channel = channelForPurpose(input.purpose);
  const at = input.occurredAt ?? now();

  const event = await db.consentEvent.create({
    data: {
      organizationId: input.organizationId,
      applicantId: input.applicantId,
      channel,
      purpose: input.purpose,
      contactValue: input.contactValue,
      action: input.action,
      disclosureKey: input.disclosure.key,
      disclosureVersion: input.disclosure.version,
      disclosureText: input.disclosure.text,
      source: input.source,
      occurredAt: at,
    },
  });

  const granted = input.action === ConsentAction.GRANTED || input.action === ConsentAction.RESUMED;
  const suppressing = input.action === ConsentAction.SUPPRESSED;

  await db.channelPermission.upsert({
    where: {
      organizationId_applicantId_channel_purpose_contactValue: {
        organizationId: input.organizationId,
        applicantId: input.applicantId,
        channel,
        purpose: input.purpose,
        contactValue: input.contactValue,
      },
    },
    create: {
      organizationId: input.organizationId,
      applicantId: input.applicantId,
      channel,
      purpose: input.purpose,
      contactValue: input.contactValue,
      granted,
      suppressed: suppressing,
      suppressedAt: suppressing ? at : null,
      suppressionSource: suppressing ? input.source : null,
      lastEventId: event.id,
    },
    update: {
      granted,
      // A RESUMED (explicit START / new opt-in) lifts suppression. Nothing
      // else does.
      ...(suppressing
        ? { suppressed: true, suppressedAt: at, suppressionSource: input.source }
        : input.action === ConsentAction.RESUMED
          ? { suppressed: false, suppressedAt: null, suppressionSource: null }
          : {}),
      lastEventId: event.id,
    },
  });

  return event;
}

/**
 * Suppress EVERY SMS purpose for a contact value across the organization.
 *
 * A STOP arrives from a phone number, not from a case. If that number appears
 * on more than one case we suppress it on all of them: honouring an opt-out is
 * not a place to be clever about identity.
 */
export async function suppressSmsForContactValue(
  db: DbOrTx,
  input: { organizationId: string; contactValue: string; source: string; occurredAt?: Date },
) {
  const at = input.occurredAt ?? now();

  // The number-level record first, because it is the one that holds whether
  // or not a case exists now or ever will.
  await db.smsSuppression.upsert({
    where: {
      organizationId_contactValue: {
        organizationId: input.organizationId,
        contactValue: input.contactValue,
      },
    },
    create: {
      organizationId: input.organizationId,
      contactValue: input.contactValue,
      suppressedAt: at,
      source: input.source,
    },
    update: { suppressedAt: at, source: input.source, liftedAt: null, liftedSource: null },
  });

  const permissions = await db.channelPermission.findMany({
    where: {
      organizationId: input.organizationId,
      contactValue: input.contactValue,
      channel: ContactChannel.SMS,
    },
    select: { applicantId: true, purpose: true },
  });

  const applicantIds = new Set(permissions.map((p) => p.applicantId));
  // Also catch cases that hold this number but have no SMS permission row yet.
  const contactPoints = await db.contactPoint.findMany({
    where: { organizationId: input.organizationId, channel: ContactChannel.SMS, value: input.contactValue },
    select: { applicantId: true },
  });
  for (const cp of contactPoints) applicantIds.add(cp.applicantId);

  const smsPurposes: ConsentPurpose[] = [
    ConsentPurpose.RECRUITER_SMS,
    ConsentPurpose.INTAKE_SMS,
    ConsentPurpose.APPOINTMENT_REMINDER_SMS,
  ];

  for (const applicantId of applicantIds) {
    for (const purpose of smsPurposes) {
      await recordConsent(db, {
        organizationId: input.organizationId,
        applicantId,
        purpose,
        contactValue: input.contactValue,
        action: ConsentAction.SUPPRESSED,
        disclosure: {
          key: 'sms_opt_out',
          version: 1,
          text: 'The recipient opted out of text messages. Suppression is durable until they opt back in.',
        },
        source: input.source,
        occurredAt: at,
      });
    }
  }

  return [...applicantIds];
}

export async function resumeSmsForContactValue(
  db: DbOrTx,
  input: { organizationId: string; contactValue: string; source: string; occurredAt?: Date },
) {
  const at = input.occurredAt ?? now();

  // Lift the number-level suppression. Only an explicit opt-in reaches here.
  await db.smsSuppression.updateMany({
    where: { organizationId: input.organizationId, contactValue: input.contactValue, liftedAt: null },
    data: { liftedAt: at, liftedSource: input.source },
  });

  const permissions = await db.channelPermission.findMany({
    where: {
      organizationId: input.organizationId,
      contactValue: input.contactValue,
      channel: ContactChannel.SMS,
      suppressed: true,
    },
    select: { applicantId: true, purpose: true },
  });
  for (const p of permissions) {
    await recordConsent(db, {
      organizationId: input.organizationId,
      applicantId: p.applicantId,
      purpose: p.purpose,
      contactValue: input.contactValue,
      action: ConsentAction.RESUMED,
      disclosure: {
        key: 'sms_opt_in_keyword',
        version: 1,
        text: 'The recipient sent START, which is an explicit request to resume text messages.',
      },
      source: input.source,
      occurredAt: at,
    });
  }
  return permissions.map((p) => p.applicantId);
}

export type PermissionCheck =
  | { allowed: true; contactValue: string }
  | { allowed: false; reason: string; code: 'no_permission' | 'suppressed' | 'no_contact_point' };

/** The pre-dispatch permission gate. Called before scheduling AND before send. */
export async function checkSendPermission(
  db: DbOrTx,
  input: {
    organizationId: string;
    applicantId: string;
    purpose: ConsentPurpose;
    contactValue: string;
  },
): Promise<PermissionCheck> {
  const channel = channelForPurpose(input.purpose);
  const permission = await db.channelPermission.findUnique({
    where: {
      organizationId_applicantId_channel_purpose_contactValue: {
        organizationId: input.organizationId,
        applicantId: input.applicantId,
        channel,
        purpose: input.purpose,
        contactValue: input.contactValue,
      },
    },
  });

  // The number's own suppression record is checked first: it exists whether or
  // not this number has ever had a case, and it outlives every case it had.
  if (channel === ContactChannel.SMS) {
    const numberSuppressed = await db.smsSuppression.findFirst({
      where: {
        organizationId: input.organizationId,
        contactValue: input.contactValue,
        liftedAt: null,
      },
      select: { id: true },
    });
    if (numberSuppressed) {
      return {
        allowed: false,
        code: 'suppressed',
        reason: `${maskContact(input.contactValue)} has opted out of text messages. A recruiter cannot override an opt-out.`,
      };
    }
  }

  // Suppression is checked across the organization for this number, not just
  // for this case's permission row.
  const suppressedAnywhere = await db.channelPermission.findFirst({
    where: {
      organizationId: input.organizationId,
      contactValue: input.contactValue,
      channel,
      suppressed: true,
    },
    select: { id: true },
  });
  if (suppressedAnywhere) {
    return {
      allowed: false,
      code: 'suppressed',
      reason: `${maskContact(input.contactValue)} has opted out of ${channel} messages. A recruiter cannot override an opt-out.`,
    };
  }

  if (!permission?.granted) {
    return {
      allowed: false,
      code: 'no_permission',
      reason: `No recorded permission to contact ${maskContact(input.contactValue)} for ${input.purpose}.`,
    };
  }
  return { allowed: true, contactValue: input.contactValue };
}

export async function listPermissions(organizationId: string, applicantId: string) {
  return prisma.channelPermission.findMany({
    where: { organizationId, applicantId },
    orderBy: [{ channel: 'asc' }, { purpose: 'asc' }],
  });
}

export async function listConsentHistory(organizationId: string, applicantId: string) {
  return prisma.consentEvent.findMany({
    where: { organizationId, applicantId },
    orderBy: { occurredAt: 'desc' },
  });
}

/**
 * The purposes a recruiter may record from a conversation.
 *
 * INBOUND_CALL_RESPONSE is deliberately absent: it is not something a person
 * can say yes to, it is a fact about a call they placed, and only the inbound
 * call handler may write it.
 */
const VERBAL_DISCLOSURE: Record<Exclude<ConsentPurpose, 'INBOUND_CALL_RESPONSE'>, DisclosureKey> = {
  CALLBACK_CALL: 'callback_call',
  INTAKE_SMS: 'intake_sms',
  RECRUITER_SMS: 'recruiter_sms',
  APPOINTMENT_REMINDER_SMS: 'appointment_reminder_sms',
  EMAIL_UPDATES: 'email_updates',
};

/** A recruiter recording a permission the applicant gave verbally. */
export async function recordVerbalConsent(
  ctx: ActorContext,
  input: { applicantId: string; purpose: ConsentPurpose; contactValue: string; granted: boolean; note: string },
) {
  const organizationId = organizationIdOf(ctx);
  if (input.purpose === ConsentPurpose.INBOUND_CALL_RESPONSE) {
    throw new ValidationError(
      'That permission is created by an inbound call, not by recording one. Record SMS or callback permission instead.',
    );
  }
  const purpose: Exclude<ConsentPurpose, 'INBOUND_CALL_RESPONSE'> = input.purpose;
  return prisma.$transaction(async (tx) => {
    const disclosure = DISCLOSURES[VERBAL_DISCLOSURE[purpose]];

    const event = await recordConsent(tx, {
      organizationId,
      applicantId: input.applicantId,
      purpose: input.purpose,
      contactValue: input.contactValue,
      action: input.granted ? ConsentAction.GRANTED : ConsentAction.REVOKED,
      disclosure,
      source:
        ctx.kind === 'staff'
          ? `recruiter:${ctx.member.id}:${input.note.slice(0, 120)}`
          : `system:${ctx.jobName}`,
    });

    await auditSecurity(tx, ctx, {
      action: input.granted ? 'consent.granted' : 'consent.revoked',
      subjectType: 'consent_event',
      subjectId: event.id,
      applicantId: input.applicantId,
      metadata: {
        purpose: input.purpose,
        contact: maskContact(input.contactValue),
        disclosureVersion: disclosure.version,
      },
    });
    return event;
  });
}

import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { StaffRole, IntegrationKind, IntegrationStatus, DefinitionState, ContactChannel } from '@prisma/client';
import { hashPassword } from 'better-auth/crypto';
import { prisma } from '../src/server/db';
import { env } from '../src/env';
import { now } from '../src/server/clock';
import { isValidTimeZone } from '../src/lib/time';
import { GREETING, COMPLETION_TEXT, HANDOFF_TEXT, QUESTIONS, TEMPLATES } from '../prisma/seed-data';

/**
 * One-time bootstrap for the FIRST live organization and its administrator.
 *
 * Why this exists: staff access is invitation-only, and there is no public
 * sign-up. Something has to create the first account, and it must not be a
 * default credential shipped in the repository. So it is an interactive CLI
 * that runs once, prompts for the details, and refuses to run again.
 *
 *   pnpm bootstrap:org
 *
 * The password is read from the terminal and never written to a file, a log or
 * a repository. It is stored only as a hash, by the same hasher the login path
 * verifies against.
 */

async function prompt(question: string, options: { secret?: boolean; default?: string } = {}) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    if (options.secret) {
      // Turn off echo so a password does not end up in a screen share.
      process.stdout.write(`${question}: `);
      const stdin = process.stdin as unknown as { setRawMode?: (mode: boolean) => void };
      stdin.setRawMode?.(true);
      let value = '';
      for await (const chunk of process.stdin) {
        const text = String(chunk);
        if (text === '\r' || text === '\n' || text === '\u0004') break;
        if (text === '\u0003') throw new Error('cancelled');
        if (text === '\u007f') {
          value = value.slice(0, -1);
          continue;
        }
        value += text;
      }
      stdin.setRawMode?.(false);
      process.stdout.write('\n');
      return value.trim();
    }
    const answer = await rl.question(options.default ? `${question} [${options.default}]: ` : `${question}: `);
    return (answer.trim() || options.default || '').trim();
  } finally {
    rl.close();
  }
}

async function main() {
  console.log('');
  console.log('RecruiterOS — one-time organization bootstrap');
  console.log('---------------------------------------------');
  console.log(`Application mode: ${env.APP_MODE}`);
  console.log('');

  const liveOrganizations = await prisma.organization.count({ where: { dataScope: 'LIVE' } });
  if (liveOrganizations > 0) {
    console.error(
      'A live organization already exists. This command only creates the FIRST one; invite further staff from Settings → Users & permissions.',
    );
    process.exitCode = 1;
    return;
  }

  const name = await prompt('Organization name');
  if (name.length < 2) throw new Error('An organization name is required.');
  const slug = (await prompt('URL slug (used by the public intake link)', { default: slugify(name) })).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,48}$/.test(slug)) throw new Error('The slug must be lowercase letters, numbers and hyphens.');

  const timezone = await prompt('Default IANA timezone', { default: 'America/Chicago' });
  if (!isValidTimeZone(timezone)) throw new Error(`${timezone} is not a recognised IANA timezone.`);

  const adminName = await prompt('Administrator full name');
  const adminEmail = (await prompt('Administrator email address')).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(adminEmail)) throw new Error('That is not a valid email address.');

  const password = await prompt('Administrator password (at least 12 characters)', { secret: true });
  if (password.length < 12) throw new Error('The password must be at least 12 characters.');
  const confirm = await prompt('Confirm password', { secret: true });
  if (password !== confirm) throw new Error('Those two passwords do not match.');

  const existingUser = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (existingUser) throw new Error(`An account already exists for ${adminEmail}.`);

  const at = now();
  const passwordHash = await hashPassword(password);

  const result = await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: {
        name,
        slug,
        // A bootstrap in DEMO mode still produces a DEMO-scoped organization,
        // because the application cannot reach a real provider in that mode.
        dataScope: env.APP_MODE === 'LIVE' ? 'LIVE' : 'DEMO',
      },
    });

    await tx.organizationSettings.create({
      data: {
        organizationId: organization.id,
        defaultTimezone: timezone,
        quietHoursStartMinute: 21 * 60,
        quietHoursEndMinute: 8 * 60,
        unknownTimezonePolicy: 'BLOCK',
        routingStrategy: 'ROUND_ROBIN',
        seatLimit: 5,
        // Brief preparation starts on the deterministic local adapter. An
        // external provider is an explicit later decision.
        aiPreparationEnabled: true,
        aiProvider: 'local-rules',
        automationEnabled: true,
        citizenshipQuestionsEnabled: false,
        minimumIntakeAge: null,
        youthPolicyNote: 'Not configured. Set this after your own organizational review.',
      },
    });

    const user = await tx.user.create({
      data: { id: randomUUID(), name: adminName, email: adminEmail, emailVerified: true },
    });
    await tx.account.create({
      data: {
        id: randomUUID(),
        accountId: user.id,
        providerId: 'credential',
        userId: user.id,
        password: passwordHash,
      },
    });
    const member = await tx.member.create({
      data: {
        id: randomUUID(),
        organizationId: organization.id,
        userId: user.id,
        role: 'owner',
        staffRole: StaffRole.ORG_ADMIN,
        displayName: adminName,
        active: true,
      },
    });
    await tx.organizationSettings.update({
      where: { organizationId: organization.id },
      data: { fallbackOwnerMemberId: member.id },
    });

    // A starting question set and the three administrative templates, all as
    // DRAFTS: nothing is published until someone reviews and approves it.
    const definition = await tx.intakeDefinition.create({
      data: { organizationId: organization.id, key: 'default', name: 'Applicant intake' },
    });
    const version = await tx.intakeVersion.create({
      data: {
        organizationId: organization.id,
        definitionId: definition.id,
        version: 1,
        state: DefinitionState.DRAFT,
        greeting: GREETING,
        completionText: COMPLETION_TEXT,
        handoffText: HANDOFF_TEXT,
      },
    });
    for (const question of QUESTIONS) {
      await tx.intakeQuestion.create({
        data: {
          organizationId: organization.id,
          intakeVersionId: version.id,
          key: question.key,
          order: question.order,
          pathway: question.pathway,
          type: question.type,
          prompt: question.prompt,
          helpText: question.helpText ?? null,
          required: question.required ?? false,
          options: question.options ?? [],
          consentPurpose: question.consentPurpose ?? null,
          disclosureKey: question.disclosureKey ?? null,
          disclosureText: question.disclosureText ?? null,
        },
      });
    }

    for (const template of TEMPLATES) {
      const record = await tx.messageTemplate.create({
        data: {
          organizationId: organization.id,
          key: template.key,
          kind: template.kind,
          channel: ContactChannel.SMS,
          name: template.name,
          automatable: template.automatable,
        },
      });
      await tx.templateVersion.create({
        data: {
          organizationId: organization.id,
          templateId: record.id,
          version: 1,
          state: DefinitionState.DRAFT,
          body: template.body,
          placeholders: template.placeholders,
        },
      });
    }

    // Every integration starts DISABLED. Nothing can reach the outside world
    // until an administrator turns it on and a check passes.
    for (const [kind, provider] of [
      [IntegrationKind.SMS, 'simulator'],
      [IntegrationKind.SMS, 'twilio'],
      [IntegrationKind.VOICE, 'simulator'],
      [IntegrationKind.VOICE, 'twilio'],
      [IntegrationKind.AI_BRIEF, 'local-rules'],
      [IntegrationKind.AI_BRIEF, 'anthropic'],
      [IntegrationKind.OUTBOUND_WEBHOOK, 'https-webhook'],
      [IntegrationKind.EMAIL, 'smtp'],
    ] as const) {
      await tx.integrationConfig.create({
        data: {
          organizationId: organization.id,
          kind,
          provider,
          enabled: false,
          status: IntegrationStatus.DISABLED,
          statusDetail: 'Disabled at bootstrap. Enable it deliberately and run a check.',
          settings: {},
        },
      });
    }

    await tx.auditEvent.create({
      data: {
        organizationId: organization.id,
        category: 'SECURITY',
        action: 'organization.bootstrapped',
        actorKind: 'cli',
        actorUserId: user.id,
        actorLabel: `bootstrap:${adminEmail}`,
        subjectType: 'organization',
        subjectId: organization.id,
        metadata: { slug, timezone, mode: env.APP_MODE },
        occurredAt: at,
      },
    });

    return { organization, member };
  });

  console.log('');
  console.log(`Created ${result.organization.name} (${result.organization.slug}).`);
  console.log(`Administrator: ${adminEmail}`);
  console.log('');
  console.log('Next, in this order:');
  console.log(`  1. Sign in at ${env.PUBLIC_APP_URL}/login`);
  console.log('  2. Settings → Intake questions: review the draft question set, then approve and publish it.');
  console.log('  3. Settings → Templates: review each draft, then approve and publish the ones you want.');
  console.log('  4. Settings → Integrations: enable only what you have configured, and run a check on each.');
  console.log('  5. Settings → Users & permissions: invite your recruiters and managers.');
  console.log('');
  console.log('Nothing can be sent to anyone until step 4 succeeds. No integration was enabled for you.');
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

main()
  .catch((error) => {
    console.error(`\nBootstrap failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

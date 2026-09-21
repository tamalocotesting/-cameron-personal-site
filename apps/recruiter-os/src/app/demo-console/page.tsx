import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, FlaskConical } from 'lucide-react';
import { Card, CardBody, CardHeader, Notice } from '@/components/ui';
import { demoToolsEnabled } from '@/env';
import { requireStaffContext } from '@/server/context';
import { prisma } from '@/server/db';
import { DemoConsole } from './DemoConsole';

export const dynamic = 'force-dynamic';

/**
 * The demo event console.
 *
 * Only exists when the deployment opted in (APP_MODE=DEMO and
 * DEMO_TOOLS_ENABLED=true). Every control here posts to /api/demo/simulate,
 * which runs the real inbound handlers — the same code path a provider
 * callback takes.
 */
export default async function DemoConsolePage() {
  if (!demoToolsEnabled) notFound();
  const ctx = await requireStaffContext();
  if (ctx.organization.dataScope !== 'DEMO') notFound();

  const [contacts, recentMessages] = await Promise.all([
    prisma.contactPoint.findMany({
      where: { organizationId: ctx.member.organizationId, channel: 'SMS' },
      orderBy: { createdAt: 'asc' },
      take: 40,
      include: { applicant: { select: { displayName: true, reference: true } } },
    }),
    prisma.message.findMany({
      where: {
        organizationId: ctx.member.organizationId,
        direction: 'OUTBOUND',
        providerMessageId: { not: null },
      },
      orderBy: { occurredAt: 'desc' },
      take: 20,
      include: { applicant: { select: { displayName: true, reference: true } } },
    }),
  ]);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-3 px-4 py-6">
      <Link href="/today" className="inline-flex items-center gap-1.5 text-[13px] text-accent underline underline-offset-2">
        <ArrowLeft size={14} aria-hidden="true" /> Back to Today
      </Link>

      <div>
        <h1 className="text-[18px] font-semibold text-ink">Demo event console</h1>
        <p className="text-[13px] text-ink-faint">
          Development and demonstration only. It is not present in a live deployment.
        </p>
      </div>

      <Notice tone="pending" icon={<FlaskConical size={14} />} title="These are real code paths">
        Each button posts to the same domain handler a Twilio callback would reach: the state machine,
        deduplication, out-of-order resolution, consent checks and task creation all run for real. Only
        the transport is simulated.
      </Notice>

      <Card>
        <CardHeader title="Simulate provider events" />
        <CardBody>
          <DemoConsole
            contacts={contacts.map((c) => ({
              value: c.value,
              label: `${c.applicant.displayName} (${c.applicant.reference}) · ${c.value}`,
            }))}
            messages={recentMessages.map((m) => ({
              id: m.id,
              label: `${m.applicant.reference} · ${m.state.toLowerCase()} · ${m.body.slice(0, 40)}`,
            }))}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Reset the demo dataset"
          description="Deletes and re-seeds the two demo organizations only. It refuses to run against anything live-scoped."
        />
        <CardBody>
          <Notice tone="review">
            This is destructive for demo data. Run it from a terminal so the intent is explicit:{' '}
            <code className="font-mono text-[12px]">pnpm seed:reset</code>. There is deliberately no
            one-click reset in the browser.
          </Notice>
        </CardBody>
      </Card>
    </div>
  );
}

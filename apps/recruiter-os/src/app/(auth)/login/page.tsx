import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card, CardBody, CardHeader, Notice } from '@/components/ui';
import { getStaffContext } from '@/server/context';
import { demoToolsEnabled, env } from '@/env';
import { LoginForm } from './LoginForm';
import { DemoSignIn } from './DemoSignIn';
import { prisma } from '@/server/db';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const ctx = await getStaffContext();
  if (ctx) redirect('/today');

  /**
   * Demo sign-in is offered ONLY when the deployment explicitly opted in
   * (APP_MODE=DEMO and DEMO_TOOLS_ENABLED=true). It signs in as a real seeded
   * member with real credentials and produces a properly authorized session —
   * it is not a client-side role switch and not an authentication bypass.
   */
  const demoMembers = demoToolsEnabled
    ? await prisma.member.findMany({
        where: { active: true, organization: { dataScope: 'DEMO' } },
        include: { user: { select: { email: true } }, organization: { select: { name: true, slug: true } } },
        orderBy: [{ staffRole: 'asc' }, { displayName: 'asc' }],
      })
    : [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Sign in" description="Use the email address your invitation was sent to." />
        <CardBody>
          <LoginForm />
          <div className="mt-3 flex flex-wrap gap-3 text-[13px]">
            <Link href="/forgot-password" className="text-accent underline underline-offset-2">
              Forgot your password?
            </Link>
          </div>
        </CardBody>
      </Card>

      {demoToolsEnabled ? (
        <Card>
          <CardHeader
            title="Demo sign-in"
            description="Available because this deployment set DEMO_TOOLS_ENABLED=true in DEMO mode."
          />
          <CardBody className="space-y-3">
            <Notice tone="pending">
              These accounts hold fictional data. Signing in here creates a normal, fully authorized
              session for a seeded member — the permission checks are the real ones.
            </Notice>
            <DemoSignIn
              members={demoMembers.map((m) => ({
                email: m.user.email,
                displayName: m.displayName,
                staffRole: m.staffRole,
                organizationName: m.organization.name,
              }))}
            />
          </CardBody>
        </Card>
      ) : (
        <Notice tone="neutral">
          No demo accounts exist in this deployment. The first live organization and administrator are
          created with the one-time bootstrap command documented in DEPLOYMENT.md
          (<code className="font-mono text-[12px]">pnpm bootstrap:org</code>). No default credential ships
          with this repository.
        </Notice>
      )}

      <p className="text-[12px] text-ink-faint">Application mode: {env.APP_MODE}</p>
    </div>
  );
}

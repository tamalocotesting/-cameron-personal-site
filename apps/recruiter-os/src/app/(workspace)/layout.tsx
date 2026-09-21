import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { getStaffContext } from '@/server/context';
import { Sidebar } from '@/components/app/Sidebar';
import { ModeBanner } from '@/components/app/ModeBanner';
import { clockDescription } from '@/server/clock';
import { workerHeartbeat } from '@/server/services/operations';
import { demoToolsEnabled, env } from '@/env';

export const dynamic = 'force-dynamic';

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getStaffContext();
  if (!ctx) redirect('/login');

  const requestHeaders = await headers();
  // Next sets this on every request; it lets the rail highlight without
  // turning the whole shell into a client component.
  const pathname = requestHeaders.get('x-invoke-path') ?? requestHeaders.get('x-pathname') ?? '';
  const heartbeat = await workerHeartbeat();

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <a href="#workspace-main" className="skip-link">
        Skip to content
      </a>
      <Sidebar
        pathname={pathname}
        staffRole={ctx.member.staffRole}
        organizationName={ctx.organization.name}
        memberName={ctx.member.displayName}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <ModeBanner
          appMode={env.APP_MODE}
          dataScope={ctx.organization.dataScope}
          clock={clockDescription()}
          workerHealthy={heartbeat.healthy}
          workerDetail={heartbeat.detail}
          demoTools={demoToolsEnabled}
        />
        <main id="workspace-main" className="min-w-0 flex-1 bg-workspace px-4 py-4 md:px-5">
          {children}
        </main>
      </div>
    </div>
  );
}

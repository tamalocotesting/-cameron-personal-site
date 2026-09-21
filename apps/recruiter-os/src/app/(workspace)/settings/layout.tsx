import Link from 'next/link';
import { headers } from 'next/headers';
import { Notice } from '@/components/ui';
import { requireStaffContext } from '@/server/context';
import { canManageOrganization } from '@/server/authz/policy';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const TABS = [
  { href: '/settings', label: 'Organization' },
  { href: '/settings/intake', label: 'Intake questions' },
  { href: '/settings/templates', label: 'Templates' },
  { href: '/settings/integrations', label: 'Integrations' },
  { href: '/settings/users', label: 'Users & permissions' },
  { href: '/settings/retention', label: 'Retention' },
  { href: '/settings/audit', label: 'Audit history' },
  { href: '/settings/commercial', label: 'Commercial' },
] as const;

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireStaffContext();
  const pathname = (await headers()).get('x-pathname') ?? '/settings';

  if (!canManageOrganization(ctx)) {
    return (
      <div className="space-y-3">
        <h1 className="text-[17px] font-semibold text-ink">Settings</h1>
        <Notice tone="neutral" title="Not available for your role">
          Organization settings, integrations and permissions are limited to organization
          administrators. Note that this role on its own does not grant access to conversation
          content — that needs an explicit, audited grant.
        </Notice>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-[17px] font-semibold text-ink">Settings</h1>
        <p className="text-[13px] text-ink-faint">{ctx.organization.name}</p>
      </div>

      <div className="overflow-x-auto">
        <nav aria-label="Settings sections" className="flex gap-1 border-b border-line">
          {TABS.map((tab) => {
            const active = tab.href === '/settings' ? pathname === '/settings' : pathname.startsWith(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'touch-target -mb-px whitespace-nowrap border-b-2 px-3 py-2 text-[13px]',
                  active
                    ? 'border-accent font-semibold text-accent'
                    : 'border-transparent text-ink-faint hover:text-ink',
                )}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>

      {children}
    </div>
  );
}

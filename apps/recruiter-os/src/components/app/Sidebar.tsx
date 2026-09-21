import Link from 'next/link';
import {
  CalendarDays,
  ClipboardList,
  LayoutList,
  ListTodo,
  MessagesSquare,
  Settings,
  ShieldAlert,
  Users,
  BarChart3,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { StaffRole } from '@prisma/client';
import { SignOutButton } from './SignOutButton';

/**
 * The navigation rail.
 *
 * Nav visibility is a convenience, never a security boundary: every page and
 * every action re-checks authorization on the server. An admin-only item that
 * a recruiter guesses the URL of still refuses.
 */
const NAV = [
  { href: '/today', label: 'Today', icon: LayoutList },
  { href: '/applicants', label: 'Applicants', icon: ClipboardList },
  { href: '/conversations', label: 'Conversations', icon: MessagesSquare },
  { href: '/follow-ups', label: 'Follow-ups', icon: ListTodo },
  { href: '/calendar', label: 'Calendar', icon: CalendarDays },
  { href: '/team', label: 'Team', icon: Users },
  { href: '/reports', label: 'Reports', icon: BarChart3 },
] as const;

const ADMIN_NAV = [
  { href: '/operations', label: 'Operations', icon: ShieldAlert },
  { href: '/settings', label: 'Settings', icon: Settings },
] as const;

export function Sidebar({
  pathname,
  staffRole,
  organizationName,
  memberName,
}: {
  pathname: string;
  staffRole: StaffRole;
  organizationName: string;
  memberName: string;
}) {
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav
      aria-label="Workspace"
      className="flex w-full shrink-0 flex-col bg-sidebar text-sidebar-text md:w-56"
    >
      <div className="border-b border-white/10 px-4 py-4">
        <p className="text-[15px] font-semibold tracking-tight">RecruiterOS</p>
        {/* The governing rule, stated plainly and left understated. */}
        <p className="mt-0.5 text-[11px] text-sidebar-muted">AI prepares. Recruiter decides.</p>
      </div>

      <ul className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
        {NAV.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={isActive(item.href) ? 'page' : undefined}
              className={cn(
                'flex min-h-[40px] items-center gap-2.5 rounded-md px-2.5 text-[13.5px] transition-colors',
                isActive(item.href)
                  ? 'bg-sidebar-active font-semibold text-white'
                  : 'text-sidebar-muted hover:bg-sidebar-hover hover:text-white',
              )}
            >
              <item.icon size={16} aria-hidden="true" className="shrink-0" />
              {item.label}
            </Link>
          </li>
        ))}

        {staffRole === 'ORG_ADMIN' ? (
          <>
            <li className="px-2.5 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide text-sidebar-muted">
              Administration
            </li>
            {ADMIN_NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={isActive(item.href) ? 'page' : undefined}
                  className={cn(
                    'flex min-h-[40px] items-center gap-2.5 rounded-md px-2.5 text-[13.5px] transition-colors',
                    isActive(item.href)
                      ? 'bg-sidebar-active font-semibold text-white'
                      : 'text-sidebar-muted hover:bg-sidebar-hover hover:text-white',
                  )}
                >
                  <item.icon size={16} aria-hidden="true" className="shrink-0" />
                  {item.label}
                </Link>
              </li>
            ))}
          </>
        ) : null}
      </ul>

      <div className="border-t border-white/10 px-4 py-3">
        <p className="truncate text-[13px] font-medium">{memberName}</p>
        <p className="truncate text-[11.5px] text-sidebar-muted">
          {organizationName} · {staffRole.replace('_', ' ').toLowerCase()}
        </p>
        <div className="mt-2">
          <SignOutButton />
        </div>
      </div>
    </nav>
  );
}

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/manager', label: 'Dashboard' },
  { href: '/manager/issues', label: 'Issues' },
  { href: '/manager/history', label: 'History' },
  { href: '/manager/templates', label: 'Checklists' },
  { href: '/manager/pilot', label: 'Pilot metric' },
  { href: '/manager/staff', label: 'Staff' },
];

export function ManagerNav() {
  const path = usePathname();
  return (
    <nav aria-label="Manager" className="mx-auto max-w-6xl overflow-x-auto px-2">
      <ul className="flex gap-1">
        {LINKS.map((l) => {
          const active = l.href === '/manager' ? path === l.href : path.startsWith(l.href);
          return (
            <li key={l.href}>
              <Link
                href={l.href}
                aria-current={active ? 'page' : undefined}
                className={`block whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-semibold ${
                  active ? 'border-white text-white' : 'border-transparent text-slate-300 hover:text-white'
                }`}
              >
                {l.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

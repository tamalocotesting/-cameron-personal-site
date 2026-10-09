import Link from 'next/link';
import { requireManager } from '@/lib/auth';
import { SampleBanner } from '@/components/ui';
import { SignOutButton } from '@/components/SignOutButton';
import { ManagerNav } from './ManagerNav';

export default async function ManagerLayout({ children }: { children: React.ReactNode }) {
  const user = await requireManager();
  return (
    <div className="min-h-dvh">
      {user.restaurantIsDemo && <SampleBanner />}
      <header className="bg-navy-900 text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div className="min-w-0">
            <Link href="/manager" className="text-lg font-bold tracking-tight">
              StationOps
            </Link>
            <p className="truncate text-xs text-slate-300">{user.restaurantName}</p>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="hidden text-slate-300 sm:inline">{user.displayName}</span>
            {user.stationId && (
              <Link href="/station" className="rounded-lg px-3 py-2 font-semibold hover:bg-navy-800">
                My station
              </Link>
            )}
            <SignOutButton className="hover:bg-navy-800" />
          </div>
        </div>
        <ManagerNav />
      </header>
      <main className="mx-auto max-w-6xl overflow-x-clip px-4 py-6">{children}</main>
    </div>
  );
}

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { SampleBanner } from '@/components/ui';
import { SignOutButton } from '@/components/SignOutButton';

export default async function StationLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  if (user.role === 'manager' && !user.stationId) redirect('/manager');

  return (
    <div className="min-h-dvh">
      {user.restaurantIsDemo && <SampleBanner />}
      <header className="bg-navy-900 text-white">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
          <Link href="/station" className="text-lg font-bold tracking-tight">
            StationOps
          </Link>
          <div className="flex items-center gap-1">
            {user.role === 'manager' && (
              <Link href="/manager" className="rounded-lg px-3 py-2 text-sm font-semibold hover:bg-navy-800">
                Manager
              </Link>
            )}
            <SignOutButton className="hover:bg-navy-800" />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 pb-40 pt-5">{children}</main>
    </div>
  );
}

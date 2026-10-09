import Link from 'next/link';
import { requireUser } from '@/lib/auth';

export const metadata = { title: 'Not available' };

export default async function DeniedPage() {
  const user = await requireUser();
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5">
      <div className="rounded-2xl border border-line bg-white p-6">
        <h1 className="text-xl font-bold">That page is for managers</h1>
        <p className="mt-2 text-muted">
          You are signed in as {user.displayName}. Your account can complete station checklists but cannot open manager tools.
        </p>
        <Link href="/" className="mt-5 inline-block rounded-lg bg-navy-900 px-4 py-3 font-semibold text-white">
          Back to my station
        </Link>
      </div>
    </main>
  );
}

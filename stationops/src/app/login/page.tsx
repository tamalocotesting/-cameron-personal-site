import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { LoginForm } from './LoginForm';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ signedOut?: string }> }) {
  const user = await getCurrentUser();
  if (user) redirect(user.role === 'manager' ? '/manager' : '/station');
  const { signedOut } = await searchParams;

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="text-2xl font-bold tracking-tight text-navy-900">StationOps</p>
          <p className="mt-1 text-sm text-muted">Station checklists for your shift</p>
        </div>
        <div className="rounded-2xl border border-line bg-white p-6 shadow-sm">
          {signedOut && (
            <p role="status" className="mb-5 rounded-lg bg-done-soft px-4 py-3 text-sm font-medium text-done">
              You are signed out.
            </p>
          )}
          <LoginForm />
        </div>
        <p className="mt-6 text-center text-sm text-muted">Forgot your password? Ask a manager to reset it.</p>
      </div>
    </main>
  );
}

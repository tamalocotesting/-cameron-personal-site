import { logoutAction } from '@/app/login/actions';

export function SignOutButton({ className = '' }: { className?: string }) {
  return (
    <form action={logoutAction}>
      <button type="submit" className={`rounded-lg px-3 py-2 text-sm font-semibold ${className}`}>
        Sign out
      </button>
    </form>
  );
}

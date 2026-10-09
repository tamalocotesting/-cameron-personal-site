'use client';

import { useActionState } from 'react';
import { loginAction, type LoginState } from './actions';

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, {});
  return (
    <form action={action} className="space-y-5" noValidate>
      {state.error && (
        <p role="alert" className="rounded-lg border border-blocked/30 bg-blocked-soft px-4 py-3 text-sm font-medium text-blocked">
          {state.error}
        </p>
      )}
      <div>
        <label htmlFor="username" className="mb-1.5 block text-sm font-semibold">
          Username
        </label>
        <input
          id="username"
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          defaultValue={state.username}
          className="block w-full rounded-lg border border-line bg-white px-4 py-3 text-base"
        />
      </div>
      <div>
        <label htmlFor="password" className="mb-1.5 block text-sm font-semibold">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="block w-full rounded-lg border border-line bg-white px-4 py-3 text-base"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-navy-900 px-4 py-3.5 text-base font-semibold text-white hover:bg-navy-800 disabled:opacity-60"
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}

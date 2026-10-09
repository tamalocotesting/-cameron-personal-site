'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { login, logout } from '@/lib/auth';

export type LoginState = { error?: string; username?: string };

const schema = z.object({
  username: z.string().trim().min(1, 'Enter your username.').max(60),
  password: z.string().min(1, 'Enter your password.').max(200),
});

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = schema.safeParse({ username: formData.get('username'), password: formData.get('password') });
  const username = String(formData.get('username') ?? '');
  if (!parsed.success) return { error: parsed.error.issues[0].message, username };

  let result;
  try {
    result = await login(parsed.data.username, parsed.data.password);
  } catch (err) {
    console.error('login failed', err);
    return { error: 'Sign-in is unavailable right now. Try again in a minute, or tell a manager.', username };
  }
  if (!result.ok) return { error: result.error, username };
  redirect(result.role === 'manager' ? '/manager' : '/station');
}

export async function logoutAction() {
  await logout();
  redirect('/login?signedOut=1');
}

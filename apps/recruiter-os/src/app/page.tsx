import { redirect } from 'next/navigation';
import { getStaffContext } from '@/server/context';

export default async function RootPage() {
  const ctx = await getStaffContext();
  redirect(ctx ? '/today' : '/login');
}

import { redirect } from 'next/navigation';

import { getSessionShopId } from '@/lib/auth/session';

export default async function Home() {
  redirect((await getSessionShopId()) ? '/dashboard' : '/login');
}
